import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// Regression test for the fixed gap: POST /:id/line-items/:lineItemId/void
// used to leave transactions.amount stale and write no audit row.

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

const TEST_ORG = 49;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;
let variantBId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-49");
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

/** Seeds a sale with two lines so voiding one still leaves the cart non-empty. */
async function seedTwoLineSale(): Promise<{ transactionId: number; lineToVoidId: number; otherLineId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 800, $2, CURRENT_DATE, 'completed', $3, 800, 0)
     RETURNING id`,
    [TEST_ORG, `line-item-void-recompute-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const lineToVoid = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'To void', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', NULL)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantAId],
  );
  const otherLine = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Stays active', 1, 300, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'active', NULL)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantBId],
  );

  return { transactionId, lineToVoidId: lineToVoid.rows[0].id, otherLineId: otherLine.rows[0].id };
}

describe("POST /:id/line-items/:lineItemId/void — recompute + audit (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("requires a reason", async () => {
    if (!ready) return;
    const { transactionId, lineToVoidId } = await seedTwoLineSale();
    const res = await request(honoApp, "POST", `/${transactionId}/line-items/${lineToVoidId}/void`, {});
    expect(res.status).toBe(400);
  });

  it("voids the line, drops transactions.amount, and writes a line_item_void audit row", async () => {
    if (!ready) return;
    const { transactionId, lineToVoidId } = await seedTwoLineSale();

    const res = await request(honoApp, "POST", `/${transactionId}/line-items/${lineToVoidId}/void`, {
      reason: "Duplicate line entered by mistake",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("voided");

    const txnRow = await db.query<{ amount: string }>(
      `SELECT amount FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(parseFloat(txnRow.rows[0].amount)).toBe(300);

    const editRow = await db.query<{ kind: string; reason: string }>(
      `SELECT kind, reason FROM accounts.transaction_edits WHERE transaction_id = $1 AND kind = 'line_item_void'`,
      [transactionId],
    );
    expect(editRow.rows.length).toBe(1);
    expect(editRow.rows[0].reason).toBe("Duplicate line entered by mistake");
  });

  it("404s a repeat void of the same line (already-voided allowlist)", async () => {
    if (!ready) return;
    const { transactionId, lineToVoidId } = await seedTwoLineSale();
    await request(honoApp, "POST", `/${transactionId}/line-items/${lineToVoidId}/void`, {
      reason: "First void",
    });
    const second = await request(honoApp, "POST", `/${transactionId}/line-items/${lineToVoidId}/void`, {
      reason: "Second void attempt",
    });
    expect(second.status).toBe(404);
  });
});
