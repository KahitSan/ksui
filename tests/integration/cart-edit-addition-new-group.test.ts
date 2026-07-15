import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// SAME-TX-EDIT-BRIEF.md test 2: an addition creating a NEW customer_group on
// an existing 1-cg transaction inserts exactly one transaction_customer_
// groups row, retroactively assigns batch_code, and upserts the
// transaction_customers pool row via ON CONFLICT.

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

const TEST_ORG = 301;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;
let clientAId: number | null;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-301");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
  clientAId = fx.clientAId;
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
    [TEST_ORG, `cart-edit-add-newgroup-${Date.now()}-${seedCounter++}`, "test-user-id"],
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

describe("POST /:id/apply-cart-edit — addition creating a new customer group (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("creates exactly one new cg row, retroactively assigns batch_code, and upserts the pool row", async () => {
    if (!ready || clientAId == null) return;
    const { transactionId } = await seedSingleGroupSale();

    const before = await db.query<{ batch_code: number | null }>(
      `SELECT batch_code FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(before.rows[0].batch_code).toBeNull();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Friend joined",
      additions: [
        {
          customer_group_id: null,
          new_group: {
            client_id: clientAId,
            display_name: "Friend",
            note: null,
            voucher_id: null,
            started_at: null,
          },
          items: [
            {
              package_id: packageId,
              package_variant_id: variantAId,
              description: "Call Booth 1hr",
              quantity: 1,
              unit_price: 500,
              duration_value: 1,
              duration_unit: "hour",
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.new_customer_group_ids.length).toBe(1);
    const newGroupId = body.new_customer_group_ids[0];

    const cgCount = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_customer_groups WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(cgCount.rows[0].n).toBe("2");

    const newGroup = await db.query<{ display_name: string; is_payer: boolean; client_id: number }>(
      `SELECT display_name, is_payer, client_id FROM accounts.transaction_customer_groups WHERE id = $1`,
      [newGroupId],
    );
    expect(newGroup.rows[0].display_name).toBe("Friend");
    expect(newGroup.rows[0].is_payer).toBe(false);
    expect(newGroup.rows[0].client_id).toBe(clientAId);

    const after = await db.query<{ batch_code: number | null }>(
      `SELECT batch_code FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(after.rows[0].batch_code).not.toBeNull();

    const poolRow = await db.query<{ client_id: number; position: number }>(
      `SELECT client_id, position FROM accounts.transaction_customers WHERE transaction_id = $1 AND client_id = $2`,
      [transactionId, clientAId],
    );
    expect(poolRow.rows.length).toBe(1);
  });

  it("a second addition creating another group does not re-assign batch_code", async () => {
    if (!ready) return;
    const { transactionId } = await seedSingleGroupSale();

    const first = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Friend joined",
      additions: [
        {
          customer_group_id: null,
          new_group: { client_id: null, display_name: "Friend A", note: null, voucher_id: null, started_at: null },
          items: [
            {
              package_id: packageId,
              package_variant_id: variantAId,
              description: "Call Booth 1hr",
              quantity: 1,
              unit_price: 500,
              duration_value: 1,
              duration_unit: "hour",
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(first.status).toBe(200);
    const afterFirst = await db.query<{ batch_code: number }>(
      `SELECT batch_code FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    const stampedBatchCode = afterFirst.rows[0].batch_code;

    const second = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Another friend joined",
      additions: [
        {
          customer_group_id: null,
          new_group: { client_id: null, display_name: "Friend B", note: null, voucher_id: null, started_at: null },
          items: [
            {
              package_id: packageId,
              package_variant_id: variantAId,
              description: "Call Booth 1hr",
              quantity: 1,
              unit_price: 500,
              duration_value: 1,
              duration_unit: "hour",
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(second.status).toBe(200);
    const afterSecond = await db.query<{ batch_code: number }>(
      `SELECT batch_code FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(afterSecond.rows[0].batch_code).toBe(stampedBatchCode);
  });
});
