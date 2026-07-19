import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// isValidAdditionItem requires quantity to be finite and > 0 — zero,
// negative, and Infinity must all 400 at body validation. Separately, a body
// with neither `reductions` nor `additions` (and no reassign_payer_to) is
// refused with its own "at least one of" 400, matching the
// hasReductions/hasAdditions/reassignPayerTo gate in the route.

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

const TEST_ORG = 335;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-335");
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
     VALUES ($1, 'sale', 'Sales - services', 500, 'cart-edit-invalid-quantity', CURRENT_DATE, 'completed', $2, 500, 0)
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

describe("POST /:id/apply-cart-edit — invalid addition quantities + empty body (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("400s on addition item quantity: 0 and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, groupId, lineId } = await seedSingleLineSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Zero quantity addition",
      additions: [
        {
          customer_group_id: groupId,
          items: [{ package_variant_id: variantAId, quantity: 0, anchor: "now" }],
        },
      ],
    });
    expect(res.status).toBe(400);
    await expectNothingMutated(transactionId, lineId);
  });

  it("400s on addition item quantity: -1 and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, groupId, lineId } = await seedSingleLineSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Negative quantity addition",
      additions: [
        {
          customer_group_id: groupId,
          items: [{ package_variant_id: variantAId, quantity: -1, anchor: "now" }],
        },
      ],
    });
    expect(res.status).toBe(400);
    await expectNothingMutated(transactionId, lineId);
  });

  it("400s on addition item quantity: Infinity and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, groupId, lineId } = await seedSingleLineSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Infinite quantity addition",
      additions: [
        {
          customer_group_id: groupId,
          items: [{ package_variant_id: variantAId, quantity: Infinity, anchor: "now" }],
        },
      ],
    });
    expect(res.status).toBe(400);
    await expectNothingMutated(transactionId, lineId);
  });

  it("400s when the body has neither reductions nor additions (nor reassign_payer_to) and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedSingleLineSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Nothing to apply",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      "At least one of reductions, additions, voucher_changes, or reassign_payer_to must be provided",
    );
    await expectNothingMutated(transactionId, lineId);
  });
});
