import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// voucher_changes: a SEPARATE array from additions, since apply-cart-edit had
// no path at all to change an EXISTING group's voucher_id (only
// insertNewCustomerGroup's INSERT ever wrote one) — see
// transactions-cart-edit.ts's voucher_changes handling and
// reprice-parent-transaction.ts:110-131's fresh re-read of cgRow.voucher_id.

let voucherAId = 0;
let voucherBId = 0;
const VOUCHER_A = {
  get id() {
    return voucherAId;
  },
  code: "CHANGEA20",
  type: "percentage" as const,
  value: "20",
  max_discount_amount: null,
  minimum_purchase: null,
};
const VOUCHER_B = {
  get id() {
    return voucherBId;
  },
  code: "CHANGEB50",
  type: "percentage" as const,
  value: "50",
  max_discount_amount: null,
  minimum_purchase: null,
};
const FOREIGN_VOUCHER_ID = 987654321;

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async () => null,
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async (id: number) => {
    if (id === voucherAId) return VOUCHER_A;
    if (id === voucherBId) return VOUCHER_B;
    return null;
  },
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 344;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-344");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
  if (!ready) return;

  const voucherA = await db.query<{ id: number }>(
    `INSERT INTO packages.vouchers (workspace_id, code, type, value)
     VALUES ($1, 'CHANGEA20', 'percentage', 20)
     RETURNING id`,
    [TEST_ORG],
  );
  voucherAId = voucherA.rows[0].id;
  const voucherB = await db.query<{ id: number }>(
    `INSERT INTO packages.vouchers (workspace_id, code, type, value)
     VALUES ($1, 'CHANGEB50', 'percentage', 50)
     RETURNING id`,
    [TEST_ORG],
  );
  voucherBId = voucherB.rows[0].id;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

/** Seeds a customer group with quantity=2 at unit_price=500 (subtotal 1000),
 *  optionally with a voucher already attached. */
async function seedSale(
  voucherId: number | null,
): Promise<{ transactionId: number; groupId: number }> {
  const discount = voucherId != null ? 200 : 0;
  const amount = 1000 - discount;
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount, voucher_id)
     VALUES ($1, 'sale', 'Sales - services', $2, $3, CURRENT_DATE, 'completed', $4, 1000, $5, NULL)
     RETURNING id`,
    [TEST_ORG, amount, `cart-edit-voucher-change-${Date.now()}-${seedCounter++}`, "test-user-id", discount],
  );
  const transactionId = txnRes.rows[0].id;

  const cg = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, voucher_id, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Payer', $3, 1000, $4, TRUE)
     RETURNING id`,
    [transactionId, TEST_ORG, voucherId, discount],
  );

  await db.query(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Voucher Session', 2, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', $5)`,
    [transactionId, TEST_ORG, packageId, variantAId, cg.rows[0].id],
  );

  return { transactionId, groupId: cg.rows[0].id };
}

async function readGroupAndTxn(transactionId: number, groupId: number) {
  const cgRow = await db.query<{ voucher_id: number | null; subtotal: string; discount_amount: string }>(
    `SELECT voucher_id, subtotal, discount_amount FROM accounts.transaction_customer_groups WHERE id = $1`,
    [groupId],
  );
  const txnRow = await db.query<{ subtotal: string; discount_amount: string; amount: string }>(
    `SELECT subtotal, discount_amount, amount FROM accounts.transactions WHERE id = $1`,
    [transactionId],
  );
  return { cg: cgRow.rows[0], txn: txnRow.rows[0] };
}

describe("POST /:id/apply-cart-edit — voucher_changes (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("voucher-change-only: attaching a voucher to a bare group updates voucher_id and reprices the discount", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSale(null);

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Apply a discount code after checkout",
      voucher_changes: [{ customer_group_id: groupId, voucher_id: voucherAId }],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voucher_changed_group_ids).toEqual([groupId]);
    // subtotal unchanged at 1000; 20% off = 200 discount; amount = 800.
    expect(body.transaction.discount_amount).toBe(200);
    expect(body.transaction.amount).toBe(800);

    const { cg, txn } = await readGroupAndTxn(transactionId, groupId);
    expect(cg.voucher_id).toBe(voucherAId);
    expect(parseFloat(cg.discount_amount)).toBe(200);
    expect(parseFloat(txn.discount_amount)).toBe(200);
    expect(parseFloat(txn.amount)).toBe(800);
  });

  it("voucher-change-only: swapping to a different voucher recomputes against the new one", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSale(voucherAId);

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Customer has a better code",
      voucher_changes: [{ customer_group_id: groupId, voucher_id: voucherBId }],
    });
    expect(res.status).toBe(200);

    // 50% off 1000 = 500 discount; amount = 500.
    const { cg, txn } = await readGroupAndTxn(transactionId, groupId);
    expect(cg.voucher_id).toBe(voucherBId);
    expect(parseFloat(cg.discount_amount)).toBe(500);
    expect(parseFloat(txn.discount_amount)).toBe(500);
    expect(parseFloat(txn.amount)).toBe(500);
  });

  it("voucher REMOVAL (null) zeroes the discount", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSale(voucherAId);

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Voucher was applied by mistake",
      voucher_changes: [{ customer_group_id: groupId, voucher_id: null }],
    });
    expect(res.status).toBe(200);

    const { cg, txn } = await readGroupAndTxn(transactionId, groupId);
    expect(cg.voucher_id).toBeNull();
    expect(parseFloat(cg.discount_amount)).toBe(0);
    expect(parseFloat(txn.discount_amount)).toBe(0);
    expect(parseFloat(txn.amount)).toBe(1000);
  });

  it("combined with a reduction in one call: both the quantity and the new voucher's discount land together", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSale(null);

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Guest only needed one session, and has a discount code",
      reductions: [
        { customer_group_id: groupId, package_id: packageId, package_variant_id: variantAId, target_quantity: 1 },
      ],
      voucher_changes: [{ customer_group_id: groupId, voucher_id: voucherAId }],
    });
    expect(res.status).toBe(200);

    // New subtotal = 1000 - 500 = 500; 20% off = 100; amount = 400.
    const { cg, txn } = await readGroupAndTxn(transactionId, groupId);
    expect(cg.voucher_id).toBe(voucherAId);
    expect(parseFloat(cg.subtotal)).toBe(500);
    expect(parseFloat(cg.discount_amount)).toBe(100);
    expect(parseFloat(txn.subtotal)).toBe(500);
    expect(parseFloat(txn.discount_amount)).toBe(100);
    expect(parseFloat(txn.amount)).toBe(400);
  });

  it("a foreign/unresolvable voucher_id 400s before any lock or mutation", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSale(null);

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Applying a bogus code",
      voucher_changes: [{ customer_group_id: groupId, voucher_id: FOREIGN_VOUCHER_ID }],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("voucher_id must belong to this workspace");

    const { cg, txn } = await readGroupAndTxn(transactionId, groupId);
    expect(cg.voucher_id).toBeNull();
    expect(parseFloat(txn.discount_amount)).toBe(0);

    const editsAfter = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(editsAfter.rows[0].n).toBe("0");
  });

  it("a customer_group_id belonging to a DIFFERENT transaction 404s and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId: ownTxnId, groupId: ownGroupId } = await seedSale(null);
    const { groupId: otherGroupId } = await seedSale(null);

    const res = await request(honoApp, "POST", `/${ownTxnId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Attempted cross-transaction voucher attribution",
      voucher_changes: [{ customer_group_id: otherGroupId, voucher_id: voucherAId }],
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("customer_group_id must belong to this transaction");

    const ownGroup = await db.query<{ voucher_id: number | null }>(
      `SELECT voucher_id FROM accounts.transaction_customer_groups WHERE id = $1`,
      [ownGroupId],
    );
    expect(ownGroup.rows[0].voucher_id).toBeNull();

    const editsAfter = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1`,
      [ownTxnId],
    );
    expect(editsAfter.rows[0].n).toBe("0");
  });

  it("the same edit_token replayed twice is idempotent — one mutation, identical response", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSale(null);
    const editToken = crypto.randomUUID();
    const payload = {
      edit_token: editToken,
      reason: "Apply a discount code after checkout",
      voucher_changes: [{ customer_group_id: groupId, voucher_id: voucherAId }],
    };

    const first = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, payload);
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, payload);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody).toEqual(firstBody);

    const { cg } = await readGroupAndTxn(transactionId, groupId);
    expect(cg.voucher_id).toBe(voucherAId);
    expect(parseFloat(cg.discount_amount)).toBe(200);

    const editRows = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1 AND kind = 'cart_reduction'`,
      [transactionId],
    );
    expect(editRows.rows[0].n).toBe("1");
  });
});
