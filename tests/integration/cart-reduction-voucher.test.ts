import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// A 20%-off voucher, no cap — the VoucherForDiscount shape computeVoucherDiscount
// expects (see lib/voucher-discount.ts), mirroring extend-voucher.test.ts.
let voucherRowId: number;
const VOUCHER = {
  get id() {
    return voucherRowId;
  },
  code: "REDUCE20",
  type: "percentage" as const,
  value: "20",
  max_discount_amount: null,
  minimum_purchase: null,
};

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async () => null,
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async (id: number) => (id === voucherRowId ? VOUCHER : null),
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 43;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-43");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
  if (!ready) return;

  const voucherRes = await db.query<{ id: number }>(
    `INSERT INTO packages.vouchers (workspace_id, code, type, value)
     VALUES ($1, 'REDUCE20', 'percentage', 20)
     RETURNING id`,
    [TEST_ORG],
  );
  voucherRowId = voucherRes.rows[0].id;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

/** Seeds a voucher-discounted customer group with quantity=2 at unit_price=500. */
async function seedVoucheredSale(): Promise<{ transactionId: number; groupId: number; lineId: number }> {
  // subtotal 1000, 20% off = 200 discount, amount 800.
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount, voucher_id)
     VALUES ($1, 'sale', 'Sales - services', 800, $2, CURRENT_DATE, 'completed', $3, 1000, 200, NULL)
     RETURNING id`,
    [TEST_ORG, `cart-reduction-voucher-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const cg = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, voucher_id, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Payer', $3, 1000, 200, TRUE)
     RETURNING id`,
    [transactionId, TEST_ORG, voucherRowId],
  );

  const lineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Voucher Session', 2, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', $5)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantAId, cg.rows[0].id],
  );

  return { transactionId, groupId: cg.rows[0].id, lineId: lineRes.rows[0].id };
}

describe("POST /:id/apply-cart-edit — voucher re-application (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("recomputes discount_amount against the NEW subtotal after a reduction", async () => {
    if (!ready) return;
    const { transactionId, groupId, lineId } = await seedVoucheredSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Guest only needed one of the two sessions",
      reductions: [
        { customer_group_id: groupId, package_id: packageId, package_variant_id: variantAId, target_quantity: 1 },
      ],
    });
    expect(res.status).toBe(200);

    // New subtotal = 1000 - 500 = 500; 20% discount = 100; amount = 400.
    const txnRow = await db.query<{ subtotal: string; discount_amount: string; amount: string }>(
      `SELECT subtotal, discount_amount, amount FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(parseFloat(txnRow.rows[0].subtotal)).toBe(500);
    expect(parseFloat(txnRow.rows[0].discount_amount)).toBe(100);
    expect(parseFloat(txnRow.rows[0].amount)).toBe(400);

    const cgRow = await db.query<{ subtotal: string; discount_amount: string }>(
      `SELECT subtotal, discount_amount FROM accounts.transaction_customer_groups WHERE id = $1`,
      [groupId],
    );
    expect(parseFloat(cgRow.rows[0].subtotal)).toBe(500);
    expect(parseFloat(cgRow.rows[0].discount_amount)).toBe(100);

    const lineRow = await db.query<{ quantity: string }>(
      `SELECT quantity FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(parseFloat(lineRow.rows[0].quantity)).toBe(1);
  });
});
