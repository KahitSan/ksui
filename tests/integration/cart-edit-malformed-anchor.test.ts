import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// isValidAdditionAnchor accepts only "now", { chain_from_line_id: number },
// or { started_at: string } — a string other than "now", an empty object, or
// a bare number must all 400 at isValidAdditionEntry (body validation, before
// BEGIN), never reach a DB write.

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

const TEST_ORG = 334;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-334");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
  packageIdForMock = fx.packageId;
  variantAIdForMock = fx.variantAId;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

async function seedSingleLineSale(): Promise<{ transactionId: number; groupId: number; lineId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, 'cart-edit-malformed-anchor', CURRENT_DATE, 'completed', $2, 500, 0)
     RETURNING id`,
    [TEST_ORG, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const cg = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Payer', 500, 0, TRUE) RETURNING id`,
    [transactionId, TEST_ORG],
  );

  const line = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Existing line', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', $5)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantAId, cg.rows[0].id],
  );

  return { transactionId, groupId: cg.rows[0].id, lineId: line.rows[0].id };
}

async function expectNothingMutated(transactionId: number, lineId: number): Promise<void> {
  const lineRow = await db.query<{ status: string }>(
    `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
    [lineId],
  );
  expect(lineRow.rows[0].status).toBe("completed");

  const linesAfter = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM accounts.transaction_line_items WHERE transaction_id = $1`,
    [transactionId],
  );
  expect(linesAfter.rows[0].n).toBe("1");

  const editsAfter = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1`,
    [transactionId],
  );
  expect(editsAfter.rows[0].n).toBe("0");
}

describe("POST /:id/apply-cart-edit — malformed addition anchors (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("400s on anchor: 'garbage' (a string other than 'now') and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, groupId, lineId } = await seedSingleLineSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Malformed anchor string",
      additions: [
        {
          customer_group_id: groupId,
          items: [{ package_variant_id: variantAId, quantity: 1, anchor: "garbage" }],
        },
      ],
    });
    expect(res.status).toBe(400);
    await expectNothingMutated(transactionId, lineId);
  });

  it("400s on anchor: {} (neither chain_from_line_id nor started_at) and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, groupId, lineId } = await seedSingleLineSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Empty anchor object",
      additions: [
        {
          customer_group_id: groupId,
          items: [{ package_variant_id: variantAId, quantity: 1, anchor: {} }],
        },
      ],
    });
    expect(res.status).toBe(400);
    await expectNothingMutated(transactionId, lineId);
  });

  it("400s on anchor: 123 (a bare number) and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, groupId, lineId } = await seedSingleLineSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Numeric anchor",
      additions: [
        {
          customer_group_id: groupId,
          items: [{ package_variant_id: variantAId, quantity: 1, anchor: 123 }],
        },
      ],
    });
    expect(res.status).toBe(400);
    await expectNothingMutated(transactionId, lineId);
  });
});
