import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// SAME-TX-EDIT-BRIEF.md test 7: a forced failure mid-additions rolls back
// the ENTIRE call — zero new customer_group rows, zero new line items,
// original reductions un-applied.
//
// Deviation from the brief's literal "invalid package_variant_id" trigger:
// package_variant_id carries no FK/RPC validation in this route (the brief's
// own validation section only shape-checks it, and unlike run-charge.ts this
// route never calls the packages findVariantsByIds RPC), so a shape-invalid
// package_variant_id (<=0) only ever produces a pre-BEGIN 400 with zero DB
// writes at all — trivially atomic, but not a "mid-additions" DB rollback.
// The first `it` below covers that trivial case; the second forces a genuine
// mid-transaction ROLLBACK via a second addition entry that targets a
// customer_group_id belonging to a DIFFERENT transaction — that check only
// runs inside BEGIN, after the first addition/reduction already mutated rows
// in the same DB transaction, so it actually exercises the ROLLBACK path.

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

const TEST_ORG = 306;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-306");
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

async function seedSale(): Promise<{ transactionId: number; groupId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE, 'completed', $3, 500, 0)
     RETURNING id`,
    [TEST_ORG, `cart-edit-atomic-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const cg = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Payer', 500, 0, TRUE) RETURNING id`,
    [transactionId, TEST_ORG],
  );

  await db.query(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Original', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', $5)`,
    [transactionId, TEST_ORG, packageId, variantAId, cg.rows[0].id],
  );

  return { transactionId, groupId: cg.rows[0].id };
}

describe("POST /:id/apply-cart-edit — atomicity of a mixed reduce+add call (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("a shape-invalid package_variant_id in the second addition 400s before touching the DB", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Attempted swap",
      reductions: [
        { customer_group_id: groupId, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
      additions: [
        {
          customer_group_id: groupId,
          items: [
            {
              package_id: packageId,
              package_variant_id: variantAId,
              description: "Valid entry",
              quantity: 1,
              unit_price: 100,
              duration_value: null,
              duration_unit: null,
              anchor: "now",
            },
          ],
        },
        {
          customer_group_id: groupId,
          items: [
            {
              package_id: packageId,
              package_variant_id: -1,
              description: "Invalid entry",
              quantity: 1,
              unit_price: 100,
              duration_value: null,
              duration_unit: null,
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(400);

    const cgCount = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_customer_groups WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(cgCount.rows[0].n).toBe("1");

    const lines = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(lines.rows.length).toBe(1);
    expect(lines.rows[0].status).toBe("completed");
  });

  it("a mid-transaction failure (second addition's cg belongs to a different transaction) rolls back everything", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSale();
    const other = await seedSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Attempted swap",
      reductions: [
        { customer_group_id: groupId, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
      additions: [
        {
          customer_group_id: null,
          new_group: { client_id: null, display_name: "New Guest", note: null, voucher_id: null, started_at: null },
          items: [
            {
              package_id: packageId,
              package_variant_id: variantAId,
              description: "Would insert first",
              quantity: 1,
              unit_price: 100,
              duration_value: null,
              duration_unit: null,
              anchor: "now",
            },
          ],
        },
        {
          customer_group_id: other.groupId,
          items: [
            {
              package_id: packageId,
              package_variant_id: variantAId,
              description: "cg from a different transaction",
              quantity: 1,
              unit_price: 100,
              duration_value: null,
              duration_unit: null,
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(404);

    // Original reduction un-applied.
    const originalLines = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(originalLines.rows.length).toBe(1);
    expect(originalLines.rows[0].status).toBe("completed");

    // No new cg or line item from the first addition entry either.
    const cgCount = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_customer_groups WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(cgCount.rows[0].n).toBe("1");
  });
});
