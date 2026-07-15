import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// Regression test for tx #8932/#8933: a cashier redistributes a parent sale's
// lines to another customer via /charge (a CHILD transaction, parent_
// transaction_id set), then zeroes the parent's own lines. The REFUND_BLOCKED
// guard must compare the whole receipt FAMILY's post-reduction total against
// the whole family's payments, not just the parent's own — a parent-only
// comparison 409s on a reduction a sibling child's amount already covers.

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
const OTHER_ORG = 149;

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

/** Seeds a parent sale (single line, quantity=1) with an optional payment recorded against it. */
async function seedParentSale(unitPrice: number, paidAmount: number): Promise<{ transactionId: number; lineId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', $2, $3, CURRENT_DATE, 'completed', $4, $2, 0)
     RETURNING id`,
    [TEST_ORG, unitPrice, `cart-reduction-family-refund-parent-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const lineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Original line', 1, $5, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', NULL)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantAId, unitPrice],
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

/** Seeds a child transaction (parent_transaction_id set) with one active line and an optional payment. */
async function seedChild(
  parentTransactionId: number,
  opts: { workspaceId?: number; childStatus?: string; amount?: number; paidAmount?: number } = {},
): Promise<{ transactionId: number; lineId: number }> {
  const workspaceId = opts.workspaceId ?? TEST_ORG;
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
      workspaceId,
      amount,
      `cart-reduction-family-refund-child-${Date.now()}-${seedCounter++}`,
      childStatus,
      "test-user-id",
      parentTransactionId,
    ],
  );
  const transactionId = txnRes.rows[0].id;

  const lineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Redistributed line', 1, $5, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'active', NULL)
     RETURNING id`,
    [transactionId, workspaceId, packageId, variantAId, amount],
  );

  if (paidAmount > 0) {
    await db.query(
      `INSERT INTO accounts.transaction_payments (transaction_id, workspace_id, financial_account_id, amount)
       VALUES ($1, $2, 1, $3)`,
      [transactionId, workspaceId, paidAmount],
    );
  }

  return { transactionId, lineId: lineRes.rows[0].id };
}

async function zeroOutParent(transactionId: number) {
  return request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
    edit_token: crypto.randomUUID(),
    reason: "Redistributed to other customers",
    reductions: [
      { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
    ],
  });
}

describe("POST /:id/apply-cart-edit — family-aware REFUND_BLOCKED guard (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("(a) THE REPRO: parent ₱99/₱50 paid, unpaid child ₱447 covering the reduction -> 200", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedParentSale(99, 50);
    await seedChild(transactionId, { amount: 447 });

    const res = await zeroOutParent(transactionId);
    expect(res.status).toBe(200);

    const lineRow = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(lineRow.rows[0].status).toBe("voided");
  });

  it("(b) true family refund case: family total after reduction < family payments -> 409 with FAMILY figures", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedParentSale(100, 1000);
    const child = await seedChild(transactionId, { amount: 50 });

    const res = await zeroOutParent(transactionId);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("REFUND_BLOCKED");
    expect(body.new_total).toBe(50);
    expect(body.already_paid).toBe(1000);

    const lineRow = await db.query<{ status: string; quantity: string }>(
      `SELECT status, quantity FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(lineRow.rows[0].status).toBe("completed");
    expect(parseFloat(lineRow.rows[0].quantity)).toBe(1);

    const childLineRow = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [child.lineId],
    );
    expect(childLineRow.rows[0].status).toBe("active");
  });

  it("(c) child payments count toward already_paid", async () => {
    if (!ready) return;
    const { transactionId } = await seedParentSale(200, 0);
    await seedChild(transactionId, { amount: 100, paidAmount: 150 });

    const res = await zeroOutParent(transactionId);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("REFUND_BLOCKED");
    expect(body.new_total).toBe(100);
    expect(body.already_paid).toBe(150);
  });

  it("(d) a voided child is excluded from both sides of the family math", async () => {
    if (!ready) return;
    const { transactionId } = await seedParentSale(100, 50);
    await seedChild(transactionId, { childStatus: "voided", amount: 1000, paidAmount: 1000 });
    await seedChild(transactionId, { amount: 10 });

    const res = await zeroOutParent(transactionId);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("REFUND_BLOCKED");
    expect(body.new_total).toBe(10);
    expect(body.already_paid).toBe(50);
  });

  it("(e) a child in a DIFFERENT workspace is excluded from the family math", async () => {
    if (!ready) return;
    await db.query(
      `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
      [OTHER_ORG, `CI Workspace ${OTHER_ORG}`, "ci-ws-149"],
    );
    const { transactionId } = await seedParentSale(100, 50);
    await seedChild(transactionId, { amount: 10 });
    await seedChild(transactionId, { workspaceId: OTHER_ORG, amount: 5000 });

    const res = await zeroOutParent(transactionId);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("REFUND_BLOCKED");
    expect(body.new_total).toBe(10);
    expect(body.already_paid).toBe(50);
  });
});
