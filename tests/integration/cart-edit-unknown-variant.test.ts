import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// A syntactically-valid, positive package_variant_id that findVariantsByIds
// does NOT resolve (unknown/foreign to this workspace) must 400 with the
// workspace-membership message BEFORE BEGIN — mirrors the "packages plugin
// absent" 503 branch immediately above it in transactions-cart-edit.ts, but
// this is the sibling case where the RPC answers with a partial/empty list
// instead of null.

const UNKNOWN_VARIANT_ID = 999999999;

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async () => [],
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async () => null,
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 331;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-331");
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

async function seedSingleLineSale(): Promise<{ transactionId: number; groupId: number; lineId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, 'cart-edit-unknown-variant', CURRENT_DATE, 'completed', $2, 500, 0)
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

describe("POST /:id/apply-cart-edit — unresolved package_variant_id (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("400s with the workspace-membership message when findVariantsByIds doesn't resolve the id, and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, groupId, lineId } = await seedSingleLineSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Add an unknown package variant",
      additions: [
        {
          customer_group_id: groupId,
          items: [{ package_variant_id: UNKNOWN_VARIANT_ID, quantity: 1, anchor: "now" }],
        },
      ],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("package_variant_id must belong to this workspace");

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
  });
});
