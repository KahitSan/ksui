import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// GET /:id must resolve each customer group's voucher_id into the fields the
// counter edit cart's discount math needs (code/type/value +
// max_discount_amount/minimum_purchase) — see load-edit-transaction.ts's
// placeholder comment, which this route now removes the need for.
//
// findVoucherById collapses "vouchers plugin absent" and "no such id" into
// the same null return (see its JSDoc in lib/peers.ts) — the route can't tell
// them apart, so ABSENT_VOUCHER_ID exercises both real-world causes at once
// via one mock branch.
const RESOLVABLE_VOUCHER_ID = 4101;
const ABSENT_VOUCHER_ID = 4102;

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async () => null,
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async (id: number) =>
    id === RESOLVABLE_VOUCHER_ID
      ? {
          id: RESOLVABLE_VOUCHER_ID,
          code: "SAVE100",
          type: "fixed_amount",
          value: "100.00",
          max_discount_amount: "100.00",
          minimum_purchase: "300.00",
          is_active: true,
        }
      : null,
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 307;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
// transaction_customer_groups.voucher_id carries a real FK into
// packages.vouchers(id) in this shared schema (same soft cross-plugin-ref
// posture cart-edit-fixtures.ts documents for client_id) — seeding a
// non-null voucher_id needs a real row in a bare CI database or the insert
// 23503s, so probe before seeding rather than assuming it's there.
let vouchersSchemaReady = false;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-307");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  if (!ready) return;

  const schemaCheck = await pool.query<{ vouchers_ok: string | null }>(
    `SELECT to_regclass('packages.vouchers')::text AS vouchers_ok`,
  );
  vouchersSchemaReady = Boolean(schemaCheck.rows[0]?.vouchers_ok);
  if (vouchersSchemaReady) {
    await db.query(
      `INSERT INTO packages.vouchers (id, workspace_id, code, type, value, max_discount_amount, minimum_purchase)
       OVERRIDING SYSTEM VALUE
       VALUES ($1, $2, 'SAVE100', 'fixed_amount', 100.00, 100.00, 300.00),
              ($3, $2, 'STALE50', 'fixed_amount', 50.00, 50.00, 0.00)
       ON CONFLICT (id) DO NOTHING`,
      [RESOLVABLE_VOUCHER_ID, TEST_ORG, ABSENT_VOUCHER_ID],
    );
  }
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

/** Seeds a bare sale transaction with one customer group carrying the given
 *  voucher_id (or null). No line items needed — the resolver only reads
 *  customer_groups. */
async function seedSaleWithGroupVoucher(
  voucherId: number | null,
): Promise<{ transactionId: number; groupId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE, 'completed', $3, 500, 0)
     RETURNING id`,
    [TEST_ORG, `detail-voucher-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const cg = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer, voucher_id)
     VALUES ($1, $2, 0, 'Payer', 500, 0, TRUE, $3) RETURNING id`,
    [transactionId, TEST_ORG, voucherId],
  );

  return { transactionId, groupId: cg.rows[0].id };
}

/** Seeds a legacy-shaped sale transaction: voucher_id lives only on the
 *  top-level transactions row, zero customer_group rows — the shape counter
 *  synthesizes a single group from client-side. */
async function seedLegacySaleWithVoucher(
  voucherId: number | null,
): Promise<{ transactionId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount, voucher_id)
     VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE, 'completed', $3, 500, 0, $4)
     RETURNING id`,
    [TEST_ORG, `detail-legacy-voucher-${Date.now()}-${seedCounter++}`, "test-user-id", voucherId],
  );
  return { transactionId: txnRes.rows[0].id };
}

describe("GET /:id legacy top-level voucher resolution", () => {
  it("attaches the resolved voucher object at the top level for a legacy (no customer_group) transaction", async () => {
    if (!ready || !vouchersSchemaReady) return;
    const { transactionId } = await seedLegacySaleWithVoucher(RESOLVABLE_VOUCHER_ID);
    const res = await request(honoApp, "GET", `/${transactionId}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.customer_groups).toHaveLength(0);
    expect(body.voucher_id).toBe(RESOLVABLE_VOUCHER_ID);
    expect(body.voucher).toMatchObject({
      id: RESOLVABLE_VOUCHER_ID,
      code: "SAVE100",
      type: "fixed_amount",
      value: "100.00",
      max_discount_amount: "100.00",
      minimum_purchase: "300.00",
    });
  });

  it("degrades to top-level voucher: null while keeping voucher_id when the id can't be resolved", async () => {
    if (!ready || !vouchersSchemaReady) return;
    const { transactionId } = await seedLegacySaleWithVoucher(ABSENT_VOUCHER_ID);
    const res = await request(honoApp, "GET", `/${transactionId}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.voucher_id).toBe(ABSENT_VOUCHER_ID);
    expect(body.voucher).toBeNull();
  });
});

describe("GET /:id customer_groups voucher resolution", () => {
  it("attaches the resolved voucher object when the vouchers plugin resolves the id", async () => {
    if (!ready || !vouchersSchemaReady) return;
    const { transactionId } = await seedSaleWithGroupVoucher(RESOLVABLE_VOUCHER_ID);
    const res = await request(honoApp, "GET", `/${transactionId}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    const group = body.customer_groups.find((g: { voucher_id: number | null }) => g.voucher_id === RESOLVABLE_VOUCHER_ID);
    expect(group).toBeTruthy();
    expect(group.voucher).toMatchObject({
      id: RESOLVABLE_VOUCHER_ID,
      code: "SAVE100",
      type: "fixed_amount",
      value: "100.00",
      max_discount_amount: "100.00",
      minimum_purchase: "300.00",
    });
  });

  it("degrades to voucher: null while keeping voucher_id when the vouchers plugin can't resolve the id", async () => {
    if (!ready || !vouchersSchemaReady) return;
    const { transactionId } = await seedSaleWithGroupVoucher(ABSENT_VOUCHER_ID);
    const res = await request(honoApp, "GET", `/${transactionId}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    const group = body.customer_groups.find(
      (g: { voucher_id: number | null }) => g.voucher_id === ABSENT_VOUCHER_ID,
    );
    expect(group).toBeTruthy();
    expect(group.voucher).toBeNull();
    expect(group.voucher_id).toBe(ABSENT_VOUCHER_ID);
  });

  it("returns voucher: null for a group with no voucher at all", async () => {
    if (!ready) return;
    const { transactionId } = await seedSaleWithGroupVoucher(null);
    const res = await request(honoApp, "GET", `/${transactionId}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    const group = body.customer_groups[0];
    expect(group.voucher_id).toBeNull();
    expect(group.voucher).toBeNull();
  });
});
