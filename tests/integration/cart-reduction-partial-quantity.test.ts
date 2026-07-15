import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

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

const TEST_ORG = 42;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-42");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

/** Seeds a completed sale with a single line at quantity=3, unit_price=100. */
async function seedTripleQtySale(): Promise<{ transactionId: number; lineId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 300, $2, CURRENT_DATE, 'completed', $3, 300, 0)
     RETURNING id`,
    [TEST_ORG, `cart-reduction-partial-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const lineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Session pass', 3, 100, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', NULL)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantAId],
  );

  return { transactionId, lineId: lineRes.rows[0].id };
}

describe("POST /:id/apply-cart-edit — partial quantity (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("reduces quantity 3 -> 1 without voiding the row", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedTripleQtySale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Guest only needed one session, not three",
      reductions: [
        { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 1 },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voided_line_item_ids).toEqual([]);
    expect(body.reduced_line_items).toEqual([{ id: lineId, quantity: 1 }]);
    expect(body.transaction.amount).toBe(100);

    const lineRow = await db.query<{ status: string; quantity: string }>(
      `SELECT status, quantity FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(lineRow.rows[0].status).toBe("completed");
    expect(parseFloat(lineRow.rows[0].quantity)).toBe(1);

    const txnRow = await db.query<{ amount: string; subtotal: string }>(
      `SELECT amount, subtotal FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(parseFloat(txnRow.rows[0].amount)).toBe(100);
    expect(parseFloat(txnRow.rows[0].subtotal)).toBe(100);
  });
});
