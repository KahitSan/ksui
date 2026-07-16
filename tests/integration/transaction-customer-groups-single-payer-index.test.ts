import { afterAll, beforeAll, expect, it } from "vitest";
import pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { withRollbackDb } from "@kahitsan/plugin-sdk/test";

// migrations/20260716000000_add_transaction_customer_groups_single_payer_index.ts
// backfills a constraint that used to exist only as a hand-created prod
// index (see transactions-cart-edit.ts's is_payer comments) — this proves a
// migrations-only environment reproduces it, not just prod.

const TEST_ORG = 311;

let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;

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
     ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
    [TEST_ORG, `CI Workspace ${TEST_ORG}`, `ci-ws-${TEST_ORG}`],
  );

  const rdb = await withRollbackDb(pool, ["accounts"]);
  db = rdb.db;
  rollback = rdb.rollback;
});

afterAll(async () => {
  await rollback();
  await pool.end();
});

it("rejects a second is_payer=TRUE customer group on the same transaction with 23505", async () => {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 1000, $2, CURRENT_DATE, 'completed', $3, 1000, 0)
     RETURNING id`,
    [TEST_ORG, `single-payer-index-${Date.now()}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  await db.query(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Payer One', 500, 0, TRUE)`,
    [transactionId, TEST_ORG],
  );

  await expect(
    db.query(
      `INSERT INTO accounts.transaction_customer_groups
         (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
       VALUES ($1, $2, 1, 'Payer Two', 500, 0, TRUE)`,
      [transactionId, TEST_ORG],
    ),
  ).rejects.toMatchObject({ code: "23505" });
});
