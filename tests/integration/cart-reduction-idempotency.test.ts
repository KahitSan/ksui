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

const TEST_ORG = 46;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-46");
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

async function seedTripleQtySale(): Promise<{ transactionId: number; lineId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 300, $2, CURRENT_DATE, 'completed', $3, 300, 0)
     RETURNING id`,
    [TEST_ORG, `cart-reduction-idem-${Date.now()}-${seedCounter++}`, "test-user-id"],
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

describe("POST /:id/apply-cart-edit — idempotency (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("replays the stored payload byte-identical on a repeat call with the same edit_token, with no second mutation", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedTripleQtySale();
    const editToken = crypto.randomUUID();

    const first = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: editToken,
      reason: "Reduce to one session",
      reductions: [
        { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 1 },
      ],
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const afterFirst = await db.query<{ quantity: string; updated_at: Date }>(
      `SELECT quantity, updated_at FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );

    const second = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: editToken,
      reason: "Reduce to one session",
      reductions: [
        { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 1 },
      ],
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody).toEqual(firstBody);

    const afterSecond = await db.query<{ quantity: string; updated_at: Date }>(
      `SELECT quantity, updated_at FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(afterSecond.rows[0].updated_at.getTime()).toBe(afterFirst.rows[0].updated_at.getTime());
    expect(parseFloat(afterSecond.rows[0].quantity)).toBe(parseFloat(afterFirst.rows[0].quantity));

    const editRows = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1 AND kind = 'cart_reduction'`,
      [transactionId],
    );
    expect(editRows.rows[0].n).toBe("1");
  });
});
