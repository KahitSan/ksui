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

const TEST_ORG = 41;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;
let variantBId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-41");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
  variantBId = fx.variantBId;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

/** Seeds a completed sale with two customer groups, each with one active line. */
async function seedTwoGroupSale(): Promise<{
  transactionId: number;
  groupAId: number;
  groupBId: number;
  lineAId: number;
  lineBId: number;
}> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 800, $2, CURRENT_DATE, 'completed', $3, 800, 0)
     RETURNING id`,
    [TEST_ORG, `cart-reduction-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const cgA = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Call Booth', 500, 0, TRUE) RETURNING id`,
    [transactionId, TEST_ORG],
  );
  const cgB = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 1, 'Inner Area', 300, 0, FALSE) RETURNING id`,
    [transactionId, TEST_ORG],
  );

  const lineA = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Call Booth 1hr', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', $5)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantAId, cgA.rows[0].id],
  );
  const lineB = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Inner Area 1hr', 1, 300, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'active', $5)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantBId, cgB.rows[0].id],
  );

  return {
    transactionId,
    groupAId: cgA.rows[0].id,
    groupBId: cgB.rows[0].id,
    lineAId: lineA.rows[0].id,
    lineBId: lineB.rows[0].id,
  };
}

describe("POST /:id/apply-cart-edit — happy path (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("voids a full line to zero and drops the transaction total", async () => {
    if (!ready) return;
    const { transactionId, groupBId, lineBId } = await seedTwoGroupSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Guest cancelled the Inner Area booking",
      reductions: [
        { customer_group_id: groupBId, package_id: packageId, package_variant_id: variantBId, target_quantity: 0 },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voided_line_item_ids).toEqual([lineBId]);
    expect(body.transaction.amount).toBe(500);
    expect(body.transaction.subtotal).toBe(500);

    const txnRow = await db.query<{ amount: string; subtotal: string }>(
      `SELECT amount, subtotal FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(parseFloat(txnRow.rows[0].amount)).toBe(500);
    expect(parseFloat(txnRow.rows[0].subtotal)).toBe(500);

    const lineRow = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [lineBId],
    );
    expect(lineRow.rows[0].status).toBe("voided");

    const editRow = await db.query<{ kind: string; reason: string }>(
      `SELECT kind, reason FROM accounts.transaction_edits WHERE transaction_id = $1 AND kind = 'cart_reduction'`,
      [transactionId],
    );
    expect(editRow.rows.length).toBe(1);
    expect(editRow.rows[0].reason).toBe("Guest cancelled the Inner Area booking");

    const detail = await request(honoApp, "GET", `/${transactionId}`);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(parseFloat(detailBody.balance)).toBe(500);
    expect(detailBody.payment_status).toBe("unpaid");
  });
});
