import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// EDIT-CART-FOLLOWUPS-BRIEF.md defect 3: removing/emptying the payer must
// never strand is_payer=TRUE on a $0 group. Tests 10-13 from the brief's
// server-side guard matrix.

let variantAIdForMock = 0;
let packageIdForMock = 0;

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async (ids: number[]) =>
    ids.flatMap((id) =>
      id === variantAIdForMock
        ? [{ id, package_id: packageIdForMock, name: "Call Booth", kind: "standard", price: "500.00", currency: "PHP", duration_value: "1", duration_unit: "hour", is_active: true }]
        : [],
    ),
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async () => null,
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 310;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;
let clientBId: number | null;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-310");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
  clientBId = fx.clientBId;
  packageIdForMock = fx.packageId;
  variantAIdForMock = fx.variantAId;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

/**
 * Seeds a transaction with a payer group (one active line) and a second
 * group (one active line, client_id set when the clients schema is present
 * so the client_id-resync assertion has a real FK to check).
 */
async function seedTwoGroupSale(): Promise<{
  transactionId: number;
  payerGroupId: number;
  otherGroupId: number;
  otherClientId: number | null;
}> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 1000, $2, CURRENT_DATE, 'completed', $3, 1000, 0)
     RETURNING id`,
    [TEST_ORG, `cart-edit-payer-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const payerCg = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Payer', 500, 0, TRUE) RETURNING id`,
    [transactionId, TEST_ORG],
  );
  const otherCg = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, client_id, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 1, $3, 'Other', 500, 0, FALSE) RETURNING id`,
    [transactionId, TEST_ORG, clientBId],
  );

  await db.query(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id, client_id)
     VALUES ($1, $2, $3, $4, 'Payer line', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', $5, NULL)`,
    [transactionId, TEST_ORG, packageId, variantAId, payerCg.rows[0].id],
  );
  await db.query(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id, client_id)
     VALUES ($1, $2, $3, $4, 'Other line', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', $5, $6)`,
    [transactionId, TEST_ORG, packageId, variantAId, otherCg.rows[0].id, clientBId],
  );

  return {
    transactionId,
    payerGroupId: payerCg.rows[0].id,
    otherGroupId: otherCg.rows[0].id,
    otherClientId: clientBId,
  };
}

describe("POST /:id/apply-cart-edit — payer integrity (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("409s PAYER_REASSIGNMENT_REQUIRED when the payer's items are all removed and no reassignment is supplied", async () => {
    if (!ready) return;
    const { transactionId, payerGroupId } = await seedTwoGroupSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Remove the payer's items without reassigning",
      reductions: [
        { customer_group_id: payerGroupId, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("PAYER_REASSIGNMENT_REQUIRED");
  });

  it("reassign_payer_to the group holding all remaining active items succeeds, flips is_payer, and resyncs transactions.client_id", async () => {
    if (!ready) return;
    const { transactionId, payerGroupId, otherGroupId, otherClientId } = await seedTwoGroupSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Reassign payer to the other guest",
      reductions: [
        { customer_group_id: payerGroupId, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
      reassign_payer_to: otherGroupId,
    });
    expect(res.status).toBe(200);

    const groups = await db.query<{ id: number; is_payer: boolean }>(
      `SELECT id, is_payer FROM accounts.transaction_customer_groups WHERE transaction_id = $1 ORDER BY id`,
      [transactionId],
    );
    const payerRows = groups.rows.filter((g) => g.is_payer);
    expect(payerRows).toHaveLength(1);
    expect(payerRows[0].id).toBe(otherGroupId);

    const txn = await db.query<{ client_id: number | null }>(
      `SELECT client_id FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(txn.rows[0].client_id).toBe(otherClientId);
  });

  it("reassign_payer_to a group with zero active lines still 409s (guard checks post-flip state)", async () => {
    if (!ready) return;
    const { transactionId, payerGroupId, otherGroupId } = await seedTwoGroupSale();

    // A third, empty group to reassign onto — never had any line items.
    const emptyCg = await db.query<{ id: number }>(
      `INSERT INTO accounts.transaction_customer_groups
         (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
       VALUES ($1, $2, 2, 'Empty', 0, 0, FALSE) RETURNING id`,
      [transactionId, TEST_ORG],
    );

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Reassign to an empty group",
      reductions: [
        { customer_group_id: payerGroupId, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
      reassign_payer_to: emptyCg.rows[0].id,
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("PAYER_REASSIGNMENT_REQUIRED");

    // otherGroupId (which DOES have active items) must remain non-payer —
    // the rejected reassignment must not leave a stray flip committed.
    const other = await db.query<{ is_payer: boolean }>(
      `SELECT is_payer FROM accounts.transaction_customer_groups WHERE id = $1`,
      [otherGroupId],
    );
    expect(other.rows[0].is_payer).toBe(false);
  });

  it("reassign_payer_to AND a new_group.is_payer:true addition in the same request 400s", async () => {
    if (!ready) return;
    const { transactionId, otherGroupId } = await seedTwoGroupSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Two simultaneous payer targets",
      reassign_payer_to: otherGroupId,
      additions: [
        {
          customer_group_id: null,
          new_group: { client_id: null, display_name: "New Guest", note: null, voucher_id: null, is_payer: true, started_at: null },
          items: [{ package_variant_id: variantAId, quantity: 1, anchor: "now" }],
        },
      ],
    });
    expect(res.status).toBe(400);
  });
});
