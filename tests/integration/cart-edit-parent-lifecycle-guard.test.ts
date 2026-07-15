import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// Regression test for the fixed gap: apply-cart-edit and line-item void used
// to reprice/void against a parent transaction regardless of its lifecycle
// status, letting a voided/forfeited (written-off) receipt get corrupted.

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

const TEST_ORG = 47;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-47");
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

/** Seeds a transaction already outside the editable lifecycle, with one active line. */
async function seedNonEditableParent(
  kind: "voided" | "forfeited",
): Promise<{ transactionId: number; lineId: number }> {
  const isVoided = kind === "voided";
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by,
        subtotal, discount_amount, forfeited_at, forfeited_amount, forfeited_by, forfeited_reason)
     VALUES ($1, 'sale', 'Sales - services', 200, $2, CURRENT_DATE, $3, $4,
             200, 0, $5, $6, $7, $8)
     RETURNING id`,
    [
      TEST_ORG,
      `cart-edit-lifecycle-guard-${kind}-${Date.now()}-${seedCounter++}`,
      isVoided ? "voided" : "completed",
      "test-user-id",
      isVoided ? null : new Date(),
      isVoided ? null : 200,
      isVoided ? null : "test-user-id",
      isVoided ? null : "written off",
    ],
  );
  const transactionId = txnRes.rows[0].id;

  const lineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Session pass', 2, 100, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'active', NULL)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantAId],
  );

  return { transactionId, lineId: lineRes.rows[0].id };
}

describe("apply-cart-edit / line-item void — parent lifecycle guard (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("apply-cart-edit against a voided parent returns 409 and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedNonEditableParent("voided");

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Attempted reduction on voided receipt",
      reductions: [
        { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
    });
    expect(res.status).toBe(409);

    const line = await db.query<{ quantity: string; status: string }>(
      `SELECT quantity, status FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(line.rows[0].status).toBe("active");
    expect(parseFloat(line.rows[0].quantity)).toBe(2);

    const edits = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(edits.rows[0].n).toBe("0");
  });

  it("apply-cart-edit against a forfeited parent returns 409 and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedNonEditableParent("forfeited");

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Attempted reduction on forfeited receipt",
      reductions: [
        { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
    });
    expect(res.status).toBe(409);

    const line = await db.query<{ quantity: string }>(
      `SELECT quantity FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(parseFloat(line.rows[0].quantity)).toBe(2);

    const edits = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(edits.rows[0].n).toBe("0");
  });

  it("line-item void against a voided parent returns 409 and leaves the line active", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedNonEditableParent("voided");

    const res = await request(honoApp, "POST", `/${transactionId}/line-items/${lineId}/void`, {
      reason: "Attempted void on voided receipt",
    });
    expect(res.status).toBe(409);

    const line = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(line.rows[0].status).toBe("active");
  });
});
