import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { withRollbackDb } from "@kahitsan/plugin-sdk/test";
import { computeAccountBalances } from "../../server/lib/account-balances.js";

// Balance-read perf rewrite (correlated NOT EXISTS + OR-join -> set-based
// UNION ALL) must be byte-identical to the prior correlated-subplan formula.
// This fixture exercises every branch the two formulas could diverge on:
// split payment legs, an unpaid sale (legacy_sums fallback), a voided sale
// (excluded), a plain expense leg, a two-account transfer, and a
// self-transfer (source == destination, net to zero regardless).

// Every run seeds its OWN workspace id — no fixed id collides with real
// tenants in the shared snapshot DB, so the fixture is fully self-contained.
// eslint-disable-next-line sonarjs/pseudo-random -- test-only uniqueness, not unpredictability
const RUN_ID = 1_000_000 + Math.floor(Math.random() * 800_000_000);
const TEST_ORG = RUN_ID;

let pool: pg.Pool;
let db: PluginDb;
let rollback: () => Promise<void>;
let accountA: number;
let accountB: number;

// The pre-rewrite correlated-subplan / OR-join formula, kept verbatim here
// (not imported — it no longer exists in production code) so this test can
// assert the rewrite computes the exact same number, not just a plausible one.
async function computeLegacyFormula(
  queryDb: PluginDb,
  workspaceId: number,
  accountIds: number[]
): Promise<Record<number, number>> {
  const r = await queryDb.query<{ account_id: number; balance: string }>(
    `WITH ids AS (SELECT UNNEST($2::int[]) AS account_id),
          leg_sums AS (
            SELECT tp.financial_account_id AS account_id, SUM(tp.amount) AS amt
              FROM accounts.transaction_payments tp
              JOIN accounts.transactions t ON t.id = tp.transaction_id
             WHERE tp.workspace_id = $1 AND t.workspace_id = $1
               AND tp.financial_account_id = ANY($2::int[])
               AND t.status <> 'voided' AND t.category = 'sale'
             GROUP BY tp.financial_account_id
          ),
          legacy_sums AS (
            SELECT i.account_id,
                   SUM(CASE WHEN t.destination_account_id = i.account_id THEN t.amount ELSE 0 END)
                 - SUM(CASE WHEN t.source_account_id = i.account_id THEN t.amount ELSE 0 END) AS amt
              FROM ids i
              JOIN accounts.transactions t
                ON (t.source_account_id = i.account_id OR t.destination_account_id = i.account_id)
             WHERE t.workspace_id = $1 AND t.status <> 'voided'
               AND (t.category <> 'sale' OR NOT EXISTS (
                     SELECT 1 FROM accounts.transaction_payments tp2 WHERE tp2.transaction_id = t.id
                   ))
             GROUP BY i.account_id
          )
     SELECT i.account_id, (COALESCE(ls.amt, 0) + COALESCE(lg.amt, 0))::text AS balance
       FROM ids i
       LEFT JOIN leg_sums ls ON ls.account_id = i.account_id
       LEFT JOIN legacy_sums lg ON lg.account_id = i.account_id`,
    [workspaceId, accountIds]
  );
  const out: Record<number, number> = {};
  for (const row of r.rows) out[row.account_id] = parseFloat(row.balance) || 0;
  return out;
}

beforeAll(async () => {
  pool = new pg.Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "ks_erp",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    max: 3,
  });

  await pool.query(
    `INSERT INTO public."user" (id, email, role, name)
     VALUES ('test-user-id', 'test@ci.local', 'superuser', 'CI User')
     ON CONFLICT DO NOTHING`
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug)
     VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [TEST_ORG, `CI Workspace ${TEST_ORG}`, `ci-ws-${TEST_ORG}`]
  );

  const rdb = await withRollbackDb(pool, ["accounts"]);
  rollback = rdb.rollback;
  db = rdb.db as unknown as PluginDb;

  const tag = `bal-reconcile-${Date.now()}`;
  const a = await db.query<{ id: number }>(
    `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
       VALUES ($1, $2, 'bank') RETURNING id`,
    [TEST_ORG, `${tag}-A`]
  );
  const b = await db.query<{ id: number }>(
    `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
       VALUES ($1, $2, 'bank') RETURNING id`,
    [TEST_ORG, `${tag}-B`]
  );
  accountA = a.rows[0].id;
  accountB = b.rows[0].id;

  const insertTxn = async (
    category: string,
    sourceId: number | null,
    destId: number | null,
    amount: number,
    status: string,
    forfeited: boolean
  ): Promise<number> => {
    const r = await db.query<{ id: number }>(
      `INSERT INTO accounts.transactions
         (workspace_id, category, source_account_id, destination_account_id, amount,
          currency, description, transaction_date, status, created_by,
          forfeited_at, forfeited_amount)
       VALUES ($1, $2, $3, $4, $5, 'PHP', 'reconcile fixture', CURRENT_DATE, $6, 'test-user-id',
               CASE WHEN $7 THEN NOW() ELSE NULL END, CASE WHEN $7 THEN $5::numeric ELSE NULL END)
       RETURNING id`,
      [TEST_ORG, category, sourceId, destId, amount, status, forfeited]
    );
    return r.rows[0].id;
  };
  const insertPayment = async (txnId: number, accountId: number, amount: number) => {
    await db.query(
      `INSERT INTO accounts.transaction_payments (transaction_id, workspace_id, financial_account_id, amount)
       VALUES ($1, $2, $3, $4)`,
      [txnId, TEST_ORG, accountId, amount]
    );
  };

  // 1. split-payment sale: 1000 total, legs 600->A + 400->B
  const splitSale = await insertTxn("sale", null, accountA, 1000, "completed", false);
  await insertPayment(splitSale, accountA, 600);
  await insertPayment(splitSale, accountB, 400);

  // 2. unpaid sale into A: legacy_sums fallback, +500 to A
  await insertTxn("sale", null, accountA, 500, "completed", false);

  // 3. voided sale into B: excluded entirely
  await insertTxn("sale", null, accountB, 300, "voided", false);

  // 4. plain expense out of A: -200
  await insertTxn("expense", accountA, null, 200, "completed", false);

  // 5. transfer A -> B: -150 to A, +150 to B
  await insertTxn("business", accountA, accountB, 150, "completed", false);

  // 6. self-transfer on A: nets to zero
  await insertTxn("business", accountA, accountA, 75, "completed", false);

  // 7. forfeited sale into A, WITH a paid leg: forfeiting doesn't touch
  // amount/payments, so this must still count via leg_sums only (+250 to A)
  const forfeitedSale = await insertTxn("sale", null, accountA, 250, "completed", true);
  await insertPayment(forfeitedSale, accountA, 250);
});

afterAll(async () => {
  await rollback();
  await pool.end();
});

describe("computeAccountBalances rewrite reconciles against the pre-rewrite formula", () => {
  it("matches the legacy correlated-subplan formula exactly for every account", async () => {
    const ids = [accountA, accountB];
    const rewritten = await computeAccountBalances(db, TEST_ORG, ids);
    const legacy = await computeLegacyFormula(db, TEST_ORG, ids);
    expect(rewritten[accountA].balance).toBe(legacy[accountA]);
    expect(rewritten[accountB].balance).toBe(legacy[accountB]);
  });

  it("computes the expected balance for account A (leg + legacy + self-transfer + forfeit)", async () => {
    const result = await computeAccountBalances(db, TEST_ORG, [accountA]);
    // leg_sums: 600 (split leg) + 250 (forfeited-but-paid) = 850
    // legacy_sums: +500 (unpaid sale) - 200 (expense) - 150 (transfer out) + 0 (self-transfer) = 150
    expect(result[accountA].balance).toBe(1000);
  });

  it("computes the expected balance for account B (leg + legacy, voided excluded)", async () => {
    const result = await computeAccountBalances(db, TEST_ORG, [accountB]);
    // leg_sums: 400 (split leg); legacy_sums: +150 (transfer in); voided sale excluded
    expect(result[accountB].balance).toBe(550);
  });
});
