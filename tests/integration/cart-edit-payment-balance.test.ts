import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// SAME-TX-EDIT-BRIEF.md test 4: a transaction with an existing paid payment
// leg, after an edit adding a net amount, shows balance = new_total -
// already_paid and payment_status = 'partial' — never spawning a fresh
// $0-collected sibling transaction.

// Resolved lazily by id (set from the real seeded fixture rows in beforeAll)
// so the pre-BEGIN findVariantsByIds RPC the route now makes (B5) returns a
// real variant instead of forcing every addition through the plugin-absent
// 503 path.
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

const TEST_ORG = 303;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-303");
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

let seedCounter = 0;

async function seedPaidSale(): Promise<{ transactionId: number; groupId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 400, $2, CURRENT_DATE, 'completed', $3, 400, 0)
     RETURNING id`,
    [TEST_ORG, `cart-edit-balance-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const cg = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Payer', 400, 0, TRUE) RETURNING id`,
    [transactionId, TEST_ORG],
  );

  await db.query(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Original booking', 1, 400, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', $5)`,
    [transactionId, TEST_ORG, packageId, variantAId, cg.rows[0].id],
  );

  await db.query(
    `INSERT INTO accounts.transaction_payments (transaction_id, workspace_id, financial_account_id, amount)
     VALUES ($1, $2, 1, 400)`,
    [transactionId, TEST_ORG],
  );

  return { transactionId, groupId: cg.rows[0].id };
}

describe("POST /:id/apply-cart-edit — balance after an addition to a paid transaction (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("shows balance = new_total - already_paid and stays partial, never spawning a $0 sibling", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedPaidSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Add another hour",
      additions: [
        {
          customer_group_id: groupId,
          items: [
            {
              package_variant_id: variantAId,
              quantity: 1,
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transaction.amount).toBe(900);
    expect(body.transaction.balance).toBe(500);
    expect(body.transaction.payment_status).toBe("partial");

    const siblingRes = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transactions WHERE parent_transaction_id = $1`,
      [transactionId],
    );
    expect(siblingRes.rows[0].n).toBe("0");

    const paymentsRes = await db.query<{ n: string; total: string }>(
      `SELECT COUNT(*)::text AS n, COALESCE(SUM(amount), 0)::text AS total
         FROM accounts.transaction_payments WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(paymentsRes.rows[0].n).toBe("1");
    expect(parseFloat(paymentsRes.rows[0].total)).toBe(400);
  });
});
