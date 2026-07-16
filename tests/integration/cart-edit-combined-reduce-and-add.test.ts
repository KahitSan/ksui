import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// SAME-TX-EDIT-BRIEF.md test 3: combined reductions (down 99) + additions
// (up variantB's derived price, 300) in one call nets the parent amount to
// +300, and each touched cg's subtotal/discount_amount updates independently
// per repriceParentTransaction.
//
// The reduction empties the original payer group entirely, so this payload
// also exercises EDIT-CART-FOLLOWUPS-BRIEF.md defect 3's guard: the new
// group must claim is_payer:true or the save now 409 PAYER_REASSIGNMENT_REQUIREDs
// (the emptied payer would otherwise strand billing attribution).

// Resolved lazily by id (set from the real seeded fixture rows in beforeAll)
// so the pre-BEGIN findVariantsByIds RPC the route now makes (B5) returns a
// real variant instead of forcing every addition through the plugin-absent
// 503 path.
let variantBIdForMock = 0;
let packageIdForMock = 0;

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async (ids: number[]) =>
    ids.flatMap((id) =>
      id === variantBIdForMock
        ? [{ id, package_id: packageIdForMock, name: "Inner Area", kind: "standard", price: "300.00", currency: "PHP", duration_value: "1", duration_unit: "hour", is_active: true }]
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

const TEST_ORG = 302;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;
let variantBId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-302");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
  variantBId = fx.variantBId;
  packageIdForMock = fx.packageId;
  variantBIdForMock = fx.variantBId;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

async function seedPayerSale(): Promise<{ transactionId: number; groupAId: number; lineAId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 99, $2, CURRENT_DATE, 'completed', $3, 99, 0)
     RETURNING id`,
    [TEST_ORG, `cart-edit-combined-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const cgA = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Payer', 99, 0, TRUE) RETURNING id`,
    [transactionId, TEST_ORG],
  );

  const lineA = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Cheap add-on', 1, 99, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', $5)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantAId, cgA.rows[0].id],
  );

  return { transactionId, groupAId: cgA.rows[0].id, lineAId: lineA.rows[0].id };
}

describe("POST /:id/apply-cart-edit — combined reduce+add in one call (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("nets the parent to +300 and prices each touched cg independently", async () => {
    if (!ready) return;
    const { transactionId, groupAId } = await seedPayerSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Swap the add-on for a new guest booking",
      reductions: [
        { customer_group_id: groupAId, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
      additions: [
        {
          customer_group_id: null,
          new_group: { client_id: null, display_name: "New Guest", note: null, voucher_id: null, is_payer: true, started_at: null },
          items: [
            {
              package_variant_id: variantBId,
              quantity: 1,
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transaction.amount).toBe(300);
    expect(body.voided_line_item_ids.length).toBe(1);
    expect(body.new_customer_group_ids.length).toBe(1);
    const newGroupId = body.new_customer_group_ids[0];

    const cgARow = await db.query<{ subtotal: string }>(
      `SELECT subtotal FROM accounts.transaction_customer_groups WHERE id = $1`,
      [groupAId],
    );
    expect(parseFloat(cgARow.rows[0].subtotal)).toBe(0);

    const cgBRow = await db.query<{ subtotal: string; discount_amount: string }>(
      `SELECT subtotal, discount_amount FROM accounts.transaction_customer_groups WHERE id = $1`,
      [newGroupId],
    );
    expect(parseFloat(cgBRow.rows[0].subtotal)).toBe(300);
    expect(parseFloat(cgBRow.rows[0].discount_amount)).toBe(0);

    const txnRow = await db.query<{ amount: string; subtotal: string }>(
      `SELECT amount, subtotal FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(parseFloat(txnRow.rows[0].amount)).toBe(300);
    expect(parseFloat(txnRow.rows[0].subtotal)).toBe(300);
  });
});
