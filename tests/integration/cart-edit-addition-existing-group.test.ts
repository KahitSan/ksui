import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// SAME-TX-EDIT-BRIEF.md test 1: additions to an EXISTING customer_group land
// on the SAME transaction_id (no child transaction is ever created) and
// reprice that group correctly.

// Resolved lazily by id (set from the real seeded fixture rows in beforeAll)
// so the pre-BEGIN findVariantsByIds RPC the route now makes (B5) returns a
// real variant instead of forcing every addition through the plugin-absent
// 503 path.
let variantAIdForMock = 0;
let variantBIdForMock = 0;
let packageIdForMock = 0;

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async (ids: number[]) =>
    ids.flatMap((id) => {
      if (id === variantAIdForMock) {
        return [{ id, package_id: packageIdForMock, name: "Call Booth", kind: "standard", price: "500.00", currency: "PHP", duration_value: "1", duration_unit: "hour", is_active: true }];
      }
      if (id === variantBIdForMock) {
        return [{ id, package_id: packageIdForMock, name: "Inner Area", kind: "standard", price: "300.00", currency: "PHP", duration_value: "1", duration_unit: "hour", is_active: true }];
      }
      return [];
    }),
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async () => null,
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 300;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;
let variantBId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-300");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
  variantBId = fx.variantBId;
  packageIdForMock = fx.packageId;
  variantAIdForMock = fx.variantAId;
  variantBIdForMock = fx.variantBId;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

async function seedSingleGroupSale(): Promise<{ transactionId: number; groupId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE, 'completed', $3, 500, 0)
     RETURNING id`,
    [TEST_ORG, `cart-edit-add-existing-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const cg = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Call Booth', 500, 0, TRUE) RETURNING id`,
    [transactionId, TEST_ORG],
  );

  await db.query(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Call Booth 1hr', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', $5)`,
    [transactionId, TEST_ORG, packageId, variantAId, cg.rows[0].id],
  );

  return { transactionId, groupId: cg.rows[0].id };
}

describe("POST /:id/apply-cart-edit — addition to existing customer group (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("inserts new lines on the existing group and stays on the same transaction id", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSingleGroupSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Add another hour",
      additions: [
        {
          customer_group_id: groupId,
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
    expect(body.added_line_item_ids.length).toBe(1);
    expect(body.new_customer_group_ids).toEqual([]);
    expect(body.transaction.amount).toBe(800);
    expect(body.transaction.subtotal).toBe(800);

    // No child transaction was created — this is still the only row.
    const siblingRes = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transactions WHERE parent_transaction_id = $1`,
      [transactionId],
    );
    expect(siblingRes.rows[0].n).toBe("0");

    const newLine = await db.query<{ transaction_id: number; customer_group_id: number; status: string }>(
      `SELECT transaction_id, customer_group_id, status FROM accounts.transaction_line_items WHERE id = $1`,
      [body.added_line_item_ids[0]],
    );
    expect(newLine.rows[0].transaction_id).toBe(transactionId);
    expect(newLine.rows[0].customer_group_id).toBe(groupId);
    expect(newLine.rows[0].status).toBe("active");

    const cgRow = await db.query<{ subtotal: string }>(
      `SELECT subtotal FROM accounts.transaction_customer_groups WHERE id = $1`,
      [groupId],
    );
    expect(parseFloat(cgRow.rows[0].subtotal)).toBe(800);
  });

  // B5 regression: package_id/description/unit_price/duration_value/
  // duration_unit are no longer part of the accepted shape — the route's
  // validators don't reject unknown extra keys (isValidAdditionItem only
  // checks package_variant_id/quantity/anchor), so a client that still sends
  // a stray unit_price gets it silently ignored-and-overridden by the
  // server-derived variant price, never trusted for pricing.
  it("ignores a client-supplied unit_price and prices from the resolved variant instead", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSingleGroupSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Attempted client-supplied price override",
      additions: [
        {
          customer_group_id: groupId,
          items: [
            {
              package_variant_id: variantBId,
              quantity: 1,
              unit_price: 1,
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // variantB's real price (300) landed, not the client's spoofed 1.
    expect(body.transaction.amount).toBe(800);

    const newLine = await db.query<{ unit_price: string }>(
      `SELECT unit_price FROM accounts.transaction_line_items WHERE id = $1`,
      [body.added_line_item_ids[0]],
    );
    expect(parseFloat(newLine.rows[0].unit_price)).toBe(300);
  });
});
