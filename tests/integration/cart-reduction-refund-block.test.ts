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

const TEST_ORG = 45;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-45");
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

/** Seeds a fully-paid sale (quantity=2, unit_price=300 -> amount 600, paid in full). */
async function seedFullyPaidSale(): Promise<{ transactionId: number; lineId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 600, $2, CURRENT_DATE, 'completed', $3, 600, 0)
     RETURNING id`,
    [TEST_ORG, `cart-reduction-refund-block-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const lineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Paid session', 2, 300, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', NULL)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantAId],
  );

  await db.query(
    `INSERT INTO accounts.transaction_payments (transaction_id, workspace_id, financial_account_id, amount)
     VALUES ($1, $2, 1, 600)`,
    [transactionId, TEST_ORG],
  );

  return { transactionId, lineId: lineRes.rows[0].id };
}

describe("POST /:id/apply-cart-edit — refund-block guard (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  // Degenerate family case (no children) — the family-wide math in
  // cart-reduction-family-refund-block.test.ts collapses to this same
  // parent-only comparison when there's nothing to add, so the boundary
  // this test proves still holds under the new guard.
  it("rejects with 409 REFUND_BLOCKED and rolls back when the new total drops below what's paid", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedFullyPaidSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Guest wants a partial refund via reduction",
      reductions: [
        { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 1 },
      ],
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("REFUND_BLOCKED");
    expect(body.new_total).toBe(300);
    expect(body.already_paid).toBe(600);

    const lineRow = await db.query<{ quantity: string }>(
      `SELECT quantity FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(parseFloat(lineRow.rows[0].quantity)).toBe(2);

    const txnRow = await db.query<{ amount: string }>(
      `SELECT amount FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(parseFloat(txnRow.rows[0].amount)).toBe(600);
  });
});
