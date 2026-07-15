import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// SAME-TX-EDIT-BRIEF.md test 9: EMPTY_CART and REFUND_BLOCKED evaluate
// correctly against the same-tx-id line item/payment set once additions no
// longer spawn children. Regression coverage that the simplified
// single-table guard queries still catch the same violations the old
// family-aware queries did — AND that a legacy `parent_transaction_id`-linked
// row (a leftover shape from before this feature, or an unrelated child of
// some other flow) no longer masks either guard, since additions land on the
// SAME transaction now.

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

const TEST_ORG = 308;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-308");
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

async function seedSingleLineSale(
  unitPrice: number,
  paidAmount = 0,
  quantity = 1,
): Promise<{ transactionId: number; lineId: number }> {
  const amount = unitPrice * quantity;
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', $2, $3, CURRENT_DATE, 'completed', $4, $2, 0)
     RETURNING id`,
    [TEST_ORG, amount, `cart-edit-guards-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const lineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Only line', $5, $6, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', NULL)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantAId, quantity, unitPrice],
  );

  if (paidAmount > 0) {
    await db.query(
      `INSERT INTO accounts.transaction_payments (transaction_id, workspace_id, financial_account_id, amount)
       VALUES ($1, $2, 1, $3)`,
      [transactionId, TEST_ORG, paidAmount],
    );
  }

  return { transactionId, lineId: lineRes.rows[0].id };
}

/** Seeds a legacy-shaped linked transaction (parent_transaction_id set) with an active line and payment. */
async function seedLinkedTransaction(
  parentTransactionId: number,
  amount: number,
  paidAmount: number,
): Promise<{ transactionId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by,
        subtotal, discount_amount, parent_transaction_id)
     VALUES ($1, 'sale', 'Sales - services', $2, $3, CURRENT_DATE, 'completed', $4, $2, 0, $5)
     RETURNING id`,
    [TEST_ORG, amount, `cart-edit-guards-linked-${Date.now()}-${seedCounter++}`, "test-user-id", parentTransactionId],
  );
  const transactionId = txnRes.rows[0].id;

  await db.query(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Linked line', 1, $5, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'active', NULL)`,
    [transactionId, TEST_ORG, packageId, variantAId, amount],
  );

  if (paidAmount > 0) {
    await db.query(
      `INSERT INTO accounts.transaction_payments (transaction_id, workspace_id, financial_account_id, amount)
       VALUES ($1, $2, 1, $3)`,
      [transactionId, TEST_ORG, paidAmount],
    );
  }

  return { transactionId };
}

describe("POST /:id/apply-cart-edit — same-tx-only guards (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("EMPTY_CART 409s zeroing the parent even when a linked transaction has active lines", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedSingleLineSale(500);
    await seedLinkedTransaction(transactionId, 500, 0);

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Zero the parent's own lines",
      reductions: [
        { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("EMPTY_CART");

    const lineRow = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(lineRow.rows[0].status).toBe("completed");
  });

  it("REFUND_BLOCKED compares only this transaction's own total vs its own payments, ignoring a linked transaction's payment", async () => {
    if (!ready) return;
    // Quantity 2 so the reduction (to target_quantity 1) leaves one unit
    // active — EMPTY_CART must not fire first, isolating REFUND_BLOCKED.
    const { transactionId } = await seedSingleLineSale(50, 90, 2);
    await seedLinkedTransaction(transactionId, 10, 1000);

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Reduce below what a linked transaction's payment would have covered",
      reductions: [
        { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 1 },
      ],
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("REFUND_BLOCKED");
    expect(body.new_total).toBe(50);
    expect(body.already_paid).toBe(90);
  });

  it("an addition adding enough value clears both guards on the same transaction id", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedSingleLineSale(100, 50);

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Redistribute this booking to a new group and top up",
      reductions: [
        { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
      additions: [
        {
          customer_group_id: null,
          new_group: { client_id: null, display_name: "New Guest", note: null, voucher_id: null, started_at: null },
          items: [
            {
              package_id: packageId,
              package_variant_id: variantAId,
              description: "Replacement booking",
              quantity: 1,
              unit_price: 200,
              duration_value: null,
              duration_unit: null,
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transaction.amount).toBe(200);
    expect(body.voided_line_item_ids).toEqual([lineId]);

    const siblingRes = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transactions WHERE parent_transaction_id = $1`,
      [transactionId],
    );
    expect(siblingRes.rows[0].n).toBe("0");
  });
});
