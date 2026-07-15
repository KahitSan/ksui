import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// Was the family-aware REFUND_BLOCKED guard (tx #8932/#8933): additions used
// to land on a CHILD transaction (parent_transaction_id set) via /charge, so
// the guard summed the parent's own total/payments with any non-voided
// child's. Per SAME-TX-EDIT-BRIEF.md, additions now land on the SAME
// transaction_id and that family aggregation is deleted — the guard compares
// only this transaction's own post-reduction total against its own payments.
// This file is REWRITTEN (not deleted) to pin that behavior rather than
// leaving assertions for the deleted family-aggregation behavior in place.

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

const TEST_ORG = 145;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-145");
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

/** Seeds a parent sale (quantity=2 by default so a partial reduction leaves a unit active,
 *  keeping EMPTY_CART from firing before REFUND_BLOCKED) with an optional payment. */
async function seedParentSale(
  unitPrice: number,
  paidAmount: number,
  quantity = 2,
): Promise<{ transactionId: number; lineId: number }> {
  const amount = unitPrice * quantity;
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', $2, $3, CURRENT_DATE, 'completed', $4, $2, 0)
     RETURNING id`,
    [TEST_ORG, amount, `cart-reduction-family-refund-parent-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const lineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Original line', $5, $6, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', NULL)
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

/** Seeds a legacy-shaped linked transaction (parent_transaction_id set) with an active line and an optional payment. */
async function seedLinkedTransaction(
  parentTransactionId: number,
  opts: { childStatus?: string; amount?: number; paidAmount?: number } = {},
): Promise<{ transactionId: number }> {
  const childStatus = opts.childStatus ?? "completed";
  const amount = opts.amount ?? 0;
  const paidAmount = opts.paidAmount ?? 0;
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by,
        subtotal, discount_amount, parent_transaction_id)
     VALUES ($1, 'sale', 'Sales - services', $2, $3, CURRENT_DATE, $4, $5, $2, 0, $6)
     RETURNING id`,
    [
      TEST_ORG,
      amount,
      `cart-reduction-family-refund-linked-${Date.now()}-${seedCounter++}`,
      childStatus,
      "test-user-id",
      parentTransactionId,
    ],
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

// Reduces to 1 remaining unit (not 0) — EMPTY_CART must not fire first,
// isolating REFUND_BLOCKED for these tests. Pairs with seedParentSale's
// default quantity=2.
async function reduceParentByOneUnit(transactionId: number) {
  return request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
    edit_token: crypto.randomUUID(),
    reason: "Reduce the parent's own lines by one unit",
    reductions: [
      { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 1 },
    ],
  });
}

describe("POST /:id/apply-cart-edit — same-tx-only REFUND_BLOCKED guard (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("409s REFUND_BLOCKED using only the parent's OWN total/payments, ignoring a linked transaction's unpaid amount", async () => {
    if (!ready) return;
    // Old family behavior: a linked transaction's ₱447 unpaid amount used to
    // cover this reduction (family total 447+60 >= family paid 100) -> 200.
    // Same-tx behavior: the parent's own total drops to 60, its own paid is
    // 100, so 60 < 100 -> blocked.
    const { transactionId, lineId } = await seedParentSale(60, 100);
    await seedLinkedTransaction(transactionId, { amount: 447 });

    const res = await reduceParentByOneUnit(transactionId);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("REFUND_BLOCKED");
    expect(body.new_total).toBe(60);
    expect(body.already_paid).toBe(100);

    const lineRow = await db.query<{ status: string; quantity: string }>(
      `SELECT status, quantity FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(lineRow.rows[0].status).toBe("completed");
    expect(parseFloat(lineRow.rows[0].quantity)).toBe(2);
  });

  it("409s REFUND_BLOCKED with the parent's own figures, ignoring a linked transaction's payment", async () => {
    if (!ready) return;
    const { transactionId } = await seedParentSale(100, 1000);
    await seedLinkedTransaction(transactionId, { amount: 50 });

    const res = await reduceParentByOneUnit(transactionId);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("REFUND_BLOCKED");
    expect(body.new_total).toBe(100);
    expect(body.already_paid).toBe(1000);
  });

  it("passes when the parent's own post-reduction total still covers its own payments, regardless of a linked transaction", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedParentSale(200, 50);
    await seedLinkedTransaction(transactionId, { amount: 1000, paidAmount: 1000 });

    const res = await reduceParentByOneUnit(transactionId);
    expect(res.status).toBe(200);

    const lineRow = await db.query<{ quantity: string }>(
      `SELECT quantity FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(parseFloat(lineRow.rows[0].quantity)).toBe(1);
  });
});
