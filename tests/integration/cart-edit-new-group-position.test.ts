import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { PoolClient } from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { setupCartEditFixtures } from "./cart-edit-fixtures.js";
import { insertNewCustomerGroup } from "../../server/charge/insert-line-items.js";
import { lockParentForReprice } from "../../server/lib/reprice-parent-transaction.js";

// SAME-TX-EDIT-BRIEF.md test 10: insertNewCustomerGroup computes position as
// MAX(existing)+1 and returns a shape usable as repriceParentTransaction's
// LockedParentForReprice.cgRow input — exercised directly against real
// Postgres rather than through the route, since the assertion is about the
// helper's own contract.

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async () => null,
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async () => null,
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 309;

let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-309");
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

async function seedTransaction(): Promise<number> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 0, $2, CURRENT_DATE, 'completed', $3, 0, 0)
     RETURNING id`,
    [TEST_ORG, `cart-edit-newgroup-position-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  return txnRes.rows[0].id;
}

describe("insertNewCustomerGroup — position + repriceParentTransaction compatibility (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(pool).toBeDefined();
  });

  it("computes position as MAX(existing)+1 across successive inserts", async () => {
    if (!ready) return;
    const transactionId = await seedTransaction();
    const client = db as unknown as PoolClient;

    const first = await insertNewCustomerGroup(
      client,
      transactionId,
      TEST_ORG,
      { client_id: null, display_name: "First", note: null, voucher_id: null, is_payer: true },
      undefined,
    );
    const second = await insertNewCustomerGroup(
      client,
      transactionId,
      TEST_ORG,
      { client_id: null, display_name: "Second", note: null, voucher_id: null, is_payer: false },
      undefined,
    );

    expect(first.subtotal).toBe(0);
    expect(first.discount_amount).toBe(0);

    const rows = await db.query<{ id: number; position: number }>(
      `SELECT id, position FROM accounts.transaction_customer_groups WHERE transaction_id = $1 ORDER BY position ASC`,
      [transactionId],
    );
    expect(rows.rows.length).toBe(2);
    expect(rows.rows[0].id).toBe(first.id);
    expect(rows.rows[0].position).toBe(0);
    expect(rows.rows[1].id).toBe(second.id);
    expect(rows.rows[1].position).toBe(1);
  });

  it("returns an id lockParentForReprice can resolve into a CustomerGroupRow-compatible cgRow", async () => {
    if (!ready) return;
    const transactionId = await seedTransaction();
    const client = db as unknown as PoolClient;

    const created = await insertNewCustomerGroup(
      client,
      transactionId,
      TEST_ORG,
      { client_id: null, display_name: "Lockable", note: null, voucher_id: null, is_payer: false },
      undefined,
    );

    const locked = await lockParentForReprice(client, TEST_ORG, transactionId, created.id);
    expect(locked).not.toBeNull();
    expect(locked?.cgRow?.id).toBe(created.id);
    expect(parseFloat(String(locked?.cgRow?.subtotal))).toBe(0);
    expect(parseFloat(String(locked?.cgRow?.discount_amount))).toBe(0);
  });
});
