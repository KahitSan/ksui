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

const TEST_ORG = 44;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-44");
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

async function seedSingleLineSale(): Promise<{ transactionId: number; lineId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE, 'completed', $3, 500, 0)
     RETURNING id`,
    [TEST_ORG, `cart-reduction-empty-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const lineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Only line', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', NULL)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantAId],
  );

  return { transactionId, lineId: lineRes.rows[0].id };
}

describe("POST /:id/apply-cart-edit — empty-cart guard (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("rejects with 409 EMPTY_CART and rolls back when it would zero every line", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedSingleLineSale();
    const before = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Guest cancelled entirely",
      reductions: [
        { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("EMPTY_CART");

    const after = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(after.rows[0].status).toBe(before.rows[0].status);

    const editRows = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1 AND kind = 'cart_reduction'`,
      [transactionId],
    );
    expect(editRows.rows[0].n).toBe("0");
  });
});
