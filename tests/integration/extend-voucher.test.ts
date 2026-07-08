import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildLineItemsRouter } from "../../server/routes-line-items.js";
import { withRollbackDb, stubMiddleware } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";

/** Make an HTTP request against a Hono app and return status + json accessor. */
async function request(
  app: Hono,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: () => Promise<any> }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await app.request(path, init);
  return { status: res.status, json: () => res.json() };
}

// Unit price 500, duration 1 day, so extensionCost per quantity=1 call is
// exactly 500. package_id/variant id are seeded rows (see beforeAll) — the
// legacy shared schema still carries real FKs from packages.packages/
// packages.package_variants/packages.vouchers even though this plugin treats
// them as soft cross-plugin refs at the app layer.
let variantPackageId: number;
let variantRowId: number;
const VARIANT = {
  get id() {
    return variantRowId;
  },
  get package_id() {
    return variantPackageId;
  },
  name: "Extend Day Pass",
  kind: "standard",
  price: "500.00",
  currency: "PHP",
  duration_value: "1",
  duration_unit: "day",
  is_active: true,
};

// A 20%-off voucher, no cap — the VoucherForDiscount shape computeVoucherDiscount
// expects (see lib/voucher-discount.ts).
let voucherRowId: number;
const VOUCHER = {
  get id() {
    return voucherRowId;
  },
  code: "EXTEND20",
  type: "percentage" as const,
  value: "20",
  max_discount_amount: null,
  minimum_purchase: null,
};

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async (ids: number[]) =>
    ids.includes(variantRowId) ? [VARIANT] : null,
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async (id: number) => (id === voucherRowId ? VOUCHER : null),
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 3;
// The router's own extend handler only ever touches the `accounts` schema;
// the two seed rows below (packages.packages / packages.vouchers) are
// schema-qualified so they resolve regardless of search_path.
const SCHEMAS = ["accounts"];

let honoApp: Hono;
let pool: pg.Pool;
let db: PluginDb;
let rollback: () => Promise<void>;

beforeAll(async () => {
  pool = new pg.Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "ks_erp",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    max: 3,
  });

  await pool.query(
    `INSERT INTO public."user" (id, email, role, name)
     VALUES ('test-user-id', 'test@ci.local', 'superuser', 'CI User')
     ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug)
     VALUES (3, 'CI Workspace', 'CI Workspace')
     ON CONFLICT (id) DO NOTHING`,
  );

  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE role = 'superuser' LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("integration test needs a real superuser in public.user");

  const rdb = await withRollbackDb(pool, SCHEMAS);
  db = rdb.db as unknown as PluginDb;
  rollback = rdb.rollback;

  // Seed the legacy FK targets INSIDE the rolled-back transaction so they
  // never touch real prod data and vanish with everything else on rollback.
  const pkgRes = await db.query<{ id: number }>(
    `INSERT INTO packages.packages (workspace_id, name, type, effective_from, lineage_slug)
     VALUES ($1, 'Extend Test Package', 'daily', CURRENT_DATE, 'extend-test-pkg')
     RETURNING id`,
    [TEST_ORG],
  );
  variantPackageId = pkgRes.rows[0].id;

  const variantRes = await db.query<{ id: number }>(
    `INSERT INTO packages.package_variants
       (package_id, name, kind, duration_value, duration_unit, price, currency)
     VALUES ($1, 'Extend Day Pass', 'standard', 1, 'day', 500.00, 'PHP')
     RETURNING id`,
    [variantPackageId],
  );
  variantRowId = variantRes.rows[0].id;

  const voucherRes = await db.query<{ id: number }>(
    `INSERT INTO packages.vouchers (workspace_id, code, type, value)
     VALUES ($1, 'EXTEND20', 'percentage', 20)
     RETURNING id`,
    [TEST_ORG],
  );
  voucherRowId = voucherRes.rows[0].id;

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: TEST_ORG,
    userId,
    role: "superuser",
    wsRole: "admin",
    permissions: ["transactions.view", "transactions.create", "transactions.edit"],
  });
  const router = buildLineItemsRouter({ db, requireAuth, requireWorkspace, requirePermission });
  honoApp = new Hono();
  honoApp.use("*", (_c, next) =>
    runWithTenantContext(
      { wsId: TEST_ORG, userId, role: "superuser", wsRole: "admin" },
      () => next(),
    ),
  );
  honoApp.route("/", router);
});

afterAll(async () => {
  await rollback(); // discard every row the suite wrote, including the seed rows
  await pool.end();
});

// Distinguishes the two seedBooking calls in this suite even if Date.now()
// ties within the same millisecond.
let seedCounter = 0;

/** Inserts a parent transaction + source line item, returns their ids. */
async function seedBooking(opts: {
  subtotal: number;
  discountAmount: number;
  amount: number;
  voucherIdOnTxn?: number | null;
  customerGroup?: { voucherId: number | null; subtotal: number; discountAmount: number } | null;
}): Promise<{ transactionId: number; customerGroupId: number | null; lineItemId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date,
        status, created_by, subtotal, discount_amount, voucher_id)
     VALUES ($1, 'sale', 'Sales - services', $2, $3, CURRENT_DATE, 'completed', $4, $5, $6, $7)
     RETURNING id`,
    [
      TEST_ORG,
      opts.amount,
      `extend-voucher-test-${Date.now()}-${seedCounter++}`,
      "test-user-id",
      opts.subtotal,
      opts.discountAmount,
      opts.voucherIdOnTxn ?? null,
    ],
  );
  const transactionId = txnRes.rows[0].id;

  let customerGroupId: number | null = null;
  if (opts.customerGroup) {
    const cgRes = await db.query<{ id: number }>(
      `INSERT INTO accounts.transaction_customer_groups
         (transaction_id, workspace_id, position, display_name, voucher_id, subtotal, discount_amount, is_payer)
       VALUES ($1, $2, 0, 'Payer', $3, $4, $5, TRUE)
       RETURNING id`,
      [
        transactionId,
        TEST_ORG,
        opts.customerGroup.voucherId,
        opts.customerGroup.subtotal,
        opts.customerGroup.discountAmount,
      ],
    );
    customerGroupId = cgRes.rows[0].id;
  }

  const liRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, 'Day 1', 1, $4, 1, 'day', NOW(), NOW(), 'active', $5)
     RETURNING id`,
    [transactionId, TEST_ORG, variantPackageId, opts.subtotal, customerGroupId],
  );

  return { transactionId, customerGroupId, lineItemId: liRes.rows[0].id };
}

describe("POST /:id/extend re-applies the attached voucher (real Postgres)", () => {
  it("recomputes discount_amount/amount for a voucher-attached customer group", async () => {
    const { transactionId, customerGroupId, lineItemId } = await seedBooking({
      subtotal: 500,
      discountAmount: 100, // 20% of 500
      amount: 400,
      customerGroup: { voucherId: voucherRowId, subtotal: 500, discountAmount: 100 },
    });

    const res = await request(honoApp, "POST", `/api/transaction-line-items/${lineItemId}/extend`, {
      package_variant_id: variantRowId,
      quantity: 1,
    });
    expect(res.status).toBe(201);

    // New subtotal = 500 + 500 = 1000; 20% discount = 200; amount = 800.
    const txnRow = await db.query<{ subtotal: string; discount_amount: string; amount: string }>(
      `SELECT subtotal, discount_amount, amount FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(parseFloat(txnRow.rows[0].subtotal)).toBe(1000);
    expect(parseFloat(txnRow.rows[0].discount_amount)).toBe(200);
    expect(parseFloat(txnRow.rows[0].amount)).toBe(800);

    const cgRow = await db.query<{ subtotal: string; discount_amount: string }>(
      `SELECT subtotal, discount_amount FROM accounts.transaction_customer_groups WHERE id = $1`,
      [customerGroupId],
    );
    expect(parseFloat(cgRow.rows[0].subtotal)).toBe(1000);
    expect(parseFloat(cgRow.rows[0].discount_amount)).toBe(200);
  });

  it("leaves an un-voucher'd extend unchanged aside from the raw extension cost", async () => {
    const { transactionId, lineItemId } = await seedBooking({
      subtotal: 500,
      discountAmount: 0,
      amount: 500,
      customerGroup: null,
    });

    const res = await request(honoApp, "POST", `/api/transaction-line-items/${lineItemId}/extend`, {
      package_variant_id: variantRowId,
      quantity: 1,
    });
    expect(res.status).toBe(201);

    const txnRow = await db.query<{ subtotal: string; discount_amount: string; amount: string }>(
      `SELECT subtotal, discount_amount, amount FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(parseFloat(txnRow.rows[0].subtotal)).toBe(1000);
    expect(parseFloat(txnRow.rows[0].discount_amount)).toBe(0);
    expect(parseFloat(txnRow.rows[0].amount)).toBe(1000);
  });
});
