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

// Every run seeds its OWN workspace — no fixed id collides with real tenants
// in the shared snapshot DB, so the fixture is fully self-contained.
// eslint-disable-next-line sonarjs/pseudo-random -- test-only uniqueness, not unpredictability
const RUN_ID = 1_000_000 + Math.floor(Math.random() * 800_000_000);
const TEST_ORG = RUN_ID;
// The router's own extend handler only ever touches the `accounts` schema;
// the two seed rows below (packages.packages / packages.vouchers) are
// schema-qualified so they resolve regardless of search_path.
const SCHEMAS = ["accounts"];

let honoApp: Hono;
let pool: pg.Pool;
let db: PluginDb;
let rollback: () => Promise<void>;
let ready = false;

beforeAll(async () => {
  pool = new pg.Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "ks_erp",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    max: 3,
  });

  // packages.packages / packages.package_variants / packages.vouchers live in
  // OTHER plugins' schemas — a bare CI database (this plugin's own migrations
  // only create accounts.*) doesn't have them, so probe before seeding or the
  // suite 42P01s instead of skipping cleanly.
  const schemaCheck = await pool.query<{
    packages_ok: string | null;
    variants_ok: string | null;
    vouchers_ok: string | null;
  }>(
    `SELECT to_regclass('packages.packages')::text AS packages_ok,
            to_regclass('packages.package_variants')::text AS variants_ok,
            to_regclass('packages.vouchers')::text AS vouchers_ok`,
  );
  if (
    !schemaCheck.rows[0]?.packages_ok ||
    !schemaCheck.rows[0]?.variants_ok ||
    !schemaCheck.rows[0]?.vouchers_ok
  ) {
    return;
  }

  await pool.query(
    `INSERT INTO public."user" (id, email, role, name)
     VALUES ('test-user-id', 'test@ci.local', 'superuser', 'CI User')
     ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug)
     VALUES ($1, 'CI Workspace', $2)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_ORG, `ci-ws-${TEST_ORG}`],
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
  ready = true;
});

afterAll(async () => {
  if (ready) {
    await rollback(); // discard every row the suite wrote, including the seed rows
  }
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
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("recomputes discount_amount/amount for a voucher-attached customer group", async () => {
    if (!ready) return;
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
    if (!ready) return;
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

// Regression coverage for the edit-cart fresh-charge bug: a package added via
// /extend was always chained off the source's ends_at, so a brand-new line
// started hours in the future instead of now (tx 8694 line 8535). anchor
// "now" fixes fresh charges; the default "chain" behavior must stay exactly
// as-is so real extensions aren't broken by the fix.
describe("POST /:id/extend anchor field", () => {
  // The source line's ends_at is seeded far enough in the future that a
  // "chain" started_at and a "now" started_at can never collide by accident.
  const FUTURE_ENDS_AT_MS = Date.now() + 6 * 60 * 60 * 1000;

  /** Inserts a parent transaction + source line whose ends_at is in the future. */
  async function seedBookingWithFutureEndsAt(): Promise<{
    lineItemId: number;
    sourceEndsAt: Date;
  }> {
    const txnRes = await db.query<{ id: number }>(
      `INSERT INTO accounts.transactions
         (workspace_id, category, subcategory, amount, description, transaction_date,
          status, created_by, subtotal, discount_amount)
       VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE,
               'completed', $3, 500, 0)
       RETURNING id`,
      [TEST_ORG, `extend-anchor-test-${Date.now()}-${seedCounter++}`, "test-user-id"],
    );
    const transactionId = txnRes.rows[0].id;

    const liRes = await db.query<{ id: number; ends_at: Date }>(
      `INSERT INTO accounts.transaction_line_items
         (transaction_id, workspace_id, package_id, description, quantity, unit_price,
          duration_value, duration_unit, started_at, ends_at, status)
       VALUES ($1, $2, $3, 'Day 1', 1, 500, 1, 'day', NOW(), $4, 'active')
       RETURNING id, ends_at`,
      [transactionId, TEST_ORG, variantPackageId, new Date(FUTURE_ENDS_AT_MS)],
    );
    return { lineItemId: liRes.rows[0].id, sourceEndsAt: liRes.rows[0].ends_at };
  }

  it("anchor 'now' starts the new line at the current time, not the source's ends_at", async () => {
    if (!ready) return;
    const { lineItemId, sourceEndsAt } = await seedBookingWithFutureEndsAt();
    const before = Date.now();

    const res = await request(honoApp, "POST", `/api/transaction-line-items/${lineItemId}/extend`, {
      package_variant_id: variantRowId,
      quantity: 1,
      anchor: "now",
    });
    const after = Date.now();
    expect(res.status).toBe(201);
    const body = await res.json();

    const startedAt = new Date(body.started_at).getTime();
    const endsAt = new Date(body.ends_at).getTime();
    // Tolerance window against the DB clock rather than an exact match — the
    // request round-trip takes nonzero wall time.
    expect(startedAt).toBeGreaterThanOrEqual(before - 2000);
    expect(startedAt).toBeLessThanOrEqual(after + 2000);
    expect(startedAt).not.toBe(sourceEndsAt.getTime());
    // duration_unit is 'day' for VARIANT — ends_at is started_at + 1 day.
    expect(endsAt - startedAt).toBe(24 * 60 * 60 * 1000);
  });

  it("anchor omitted chains started_at off the source's ends_at exactly", async () => {
    if (!ready) return;
    const { lineItemId, sourceEndsAt } = await seedBookingWithFutureEndsAt();

    const res = await request(honoApp, "POST", `/api/transaction-line-items/${lineItemId}/extend`, {
      package_variant_id: variantRowId,
      quantity: 1,
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(new Date(body.started_at).getTime()).toBe(sourceEndsAt.getTime());
  });

  it("anchor 'chain' explicit chains started_at off the source's ends_at exactly", async () => {
    if (!ready) return;
    const { lineItemId, sourceEndsAt } = await seedBookingWithFutureEndsAt();

    const res = await request(honoApp, "POST", `/api/transaction-line-items/${lineItemId}/extend`, {
      package_variant_id: variantRowId,
      quantity: 1,
      anchor: "chain",
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(new Date(body.started_at).getTime()).toBe(sourceEndsAt.getTime());
  });

  it("anchor 'garbage' is rejected with 400", async () => {
    if (!ready) return;
    const { lineItemId } = await seedBookingWithFutureEndsAt();

    const res = await request(honoApp, "POST", `/api/transaction-line-items/${lineItemId}/extend`, {
      package_variant_id: variantRowId,
      quantity: 1,
      anchor: "garbage",
    });
    expect(res.status).toBe(400);
  });
});
