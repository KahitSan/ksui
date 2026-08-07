import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { makeDatabaseService } from "@kahitsan/plugin-sdk";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";
import { makeDataSurface } from "@kahitsan/plugin-sdk";

// ── F3 band leak test (transaction_payments) ─────────────────────────────────
//
// Proves, against a REAL Postgres snapshot, that `makeDataSurface` over
// `accounts.transaction_payments` cannot read / mutate / delete another
// workspace's row via the sole surviving RLS policy
// (`transaction_payments_org_isolation`) after the redundant `tp_org_isolation`
// duplicate was dropped — a single policy must still bite exactly as two did.
// Runs under a NON-superuser role — `auth.is_superuser()` would otherwise
// satisfy the policy and RLS would (correctly) not clamp, so the wall must be
// tested as a plain member. The injected `AND workspace_id` filter is the
// primary gate; this asserts the second wall holds independently of it.
//
// Self-skips when the prerequisites (the table + the canonical policy + the
// duplicate ALREADY dropped) are absent, so a bare or not-yet-migrated DB
// never false-fails. The two workspaces are always self-seeded per run.

const pool = new pg.Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "ks_erp",
});

const TAG = "__f3_tp_leak__";
// Every run seeds its OWN pair of workspaces — never borrows any two that
// could collide with real tenants in the shared snapshot DB.
// eslint-disable-next-line sonarjs/pseudo-random -- test-only uniqueness, not unpredictability
const RUN_ID = 1_000_000 + Math.floor(Math.random() * 800_000_000);
let wsA = RUN_ID;
let wsB = RUN_ID + 1;
let aRowId = 0;
let bRowId = 0;
const insertedPaymentIds: number[] = [];
const insertedTxnIds: number[] = [];
const insertedAccountIds: number[] = [];
let ready = false;

beforeAll(async () => {
  const policies = await pool.query<{ policyname: string }>(
    `SELECT policyname FROM pg_policies
      WHERE schemaname='accounts' AND tablename='transaction_payments'`,
  );
  const hasCanonical = policies.rows.some(
    (r) => r.policyname === "transaction_payments_org_isolation",
  );
  const hasDuplicate = policies.rows.some((r) => r.policyname === "tp_org_isolation");
  const usr = await pool.query<{ id: string }>(`SELECT id FROM public."user" ORDER BY id LIMIT 1`);
  if (!hasCanonical || hasDuplicate || usr.rows.length < 1) return;
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug)
     VALUES ($1, 'CI Workspace A', $2), ($3, 'CI Workspace B', $4)
     ON CONFLICT (id) DO NOTHING`,
    [wsA, `ci-ws-${wsA}`, wsB, `ci-ws-${wsB}`],
  );
  const leakUserId = usr.rows[0].id;

  // Seed one financial account, one transaction, and one payment leg per
  // workspace on the OWNER connection (bypasses RLS).
  for (const [ws_, tag] of [
    [wsA, "A"],
    [wsB, "B"],
  ] as const) {
    const acct = await pool.query<{ id: number }>(
      `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
         VALUES ($1, $2, 'bank') RETURNING id`,
      [ws_, `${TAG}-acct-${tag}`],
    );
    const txn = await pool.query<{ id: number }>(
      `INSERT INTO accounts.transactions
         (workspace_id, category, amount, description, transaction_date, created_by)
         VALUES ($1, 'sale', 100, $2, CURRENT_DATE, $3) RETURNING id`,
      [ws_, `${TAG}-txn-${tag}`, leakUserId],
    );
    const pay = await pool.query<{ id: number }>(
      `INSERT INTO accounts.transaction_payments
         (transaction_id, workspace_id, financial_account_id, amount)
         VALUES ($1, $2, $3, 100) RETURNING id`,
      [txn.rows[0].id, ws_, acct.rows[0].id],
    );
    insertedAccountIds.push(acct.rows[0].id);
    insertedTxnIds.push(txn.rows[0].id);
    insertedPaymentIds.push(pay.rows[0].id);
    if (tag === "A") aRowId = pay.rows[0].id;
    else bRowId = pay.rows[0].id;
  }
  ready = true;
});

afterAll(async () => {
  if (insertedPaymentIds.length) {
    await pool.query(`DELETE FROM accounts.transaction_payments WHERE id = ANY($1::int[])`, [
      insertedPaymentIds,
    ]);
  }
  if (insertedTxnIds.length) {
    await pool.query(`DELETE FROM accounts.transactions WHERE id = ANY($1::int[])`, [
      insertedTxnIds,
    ]);
  }
  if (insertedAccountIds.length) {
    await pool.query(`DELETE FROM accounts.financial_accounts WHERE id = ANY($1::int[])`, [
      insertedAccountIds,
    ]);
  }
  await pool.end();
});

describe("F3 makeDataSurface over accounts.transaction_payments — cross-workspace leak (real Postgres + RLS, single-policy-post-dedupe)", () => {
  const surface = () => makeDataSurface(makeDatabaseService(pool, ["accounts"]));
  // NON-superuser: a member, so RLS actually applies.
  const asA = <T>(fn: () => Promise<T>) =>
    runWithTenantContext({ wsId: wsA, userId: "uA", role: "member", wsRole: "member" }, fn);

  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(wsA).not.toBe(wsB);
    expect(aRowId).toBeGreaterThan(0);
    expect(bRowId).toBeGreaterThan(0);
  });

  it("find under A canNOT read B's payment even when explicitly targeting B's id", async () => {
    if (!ready) return;
    const rows = await asA(() =>
      surface().find("transaction_payments", ["id", "workspace_id", "amount"], {
        where: "id = $1",
        params: [bRowId],
      }),
    );
    expect(rows).toEqual([]);
  });

  it("find under A returns A's own payment (not vacuously empty)", async () => {
    if (!ready) return;
    const rows = await asA(() =>
      surface().find<{ workspace_id: number }>("transaction_payments", ["id", "workspace_id"], {
        where: "id = $1",
        params: [aRowId],
      }),
    );
    expect(rows.map((r) => r.workspace_id)).toEqual([wsA]);
  });

  it("update under A canNOT mutate B's payment (0 rows returned)", async () => {
    if (!ready) return;
    const updated = await asA(() =>
      surface().update(
        "transaction_payments",
        { notes: "hijacked" },
        { where: "id = $1", params: [bRowId] },
        ["id"],
      ),
    );
    expect(updated).toEqual([]);
    const check = await pool.query<{ notes: string | null }>(
      `SELECT notes FROM accounts.transaction_payments WHERE id=$1`,
      [bRowId],
    );
    expect(check.rows[0].notes).toBeNull();
  });

  it("delete under A canNOT remove B's payment (0 affected)", async () => {
    if (!ready) return;
    const n = await asA(() =>
      surface().delete("transaction_payments", { where: "id = $1", params: [bRowId] }),
    );
    expect(n).toBe(0);
  });

  it("escapeHatch raw query under A is STILL clamped by RLS (proves the wall, not just injection)", async () => {
    if (!ready) return;
    const rows = await asA(() =>
      surface()
        .escapeHatch()
        .query<{ id: number }>("SELECT id FROM accounts.transaction_payments WHERE id = $1", [
          bRowId,
        ]),
    );
    expect(rows.rows).toEqual([]);
  });
});
