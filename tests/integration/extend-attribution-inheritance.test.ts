import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildLineItemsRouter } from "../../server/routes-line-items.js";
import { withRollbackDb, stubMiddleware } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";

// Pins the /extend attribution-inheritance contract: the new line always
// copies the SOURCE line's customer_group_id AND client_id verbatim, never
// the caller-supplied identity. This is exactly why the counter UI's
// add-customer-in-edit-cart flow must never route a different person's items
// through /extend — extend has no way to attribute a new person, only to
// continue the same one.

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

let variantPackageId: number;
let variantRowId: number;
const VARIANT = {
  get id() {
    return variantRowId;
  },
  get package_id() {
    return variantPackageId;
  },
  name: "Attribution Day Pass",
  kind: "standard",
  price: "500.00",
  currency: "PHP",
  duration_value: "1",
  duration_unit: "day",
  is_active: true,
};

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async (ids: number[]) =>
    ids.includes(variantRowId) ? [VARIANT] : null,
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async () => null,
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 210;
// The router's own extend handler only ever touches the `accounts` schema.
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

  // packages.packages / packages.package_variants live in the packages
  // plugin's schema — a bare CI database (this plugin's own migrations only
  // create accounts.*) doesn't have them, so probe before seeding or the
  // suite 42P01s instead of skipping cleanly.
  const schemaCheck = await pool.query<{ packages_ok: string | null; variants_ok: string | null }>(
    `SELECT to_regclass('packages.packages')::text AS packages_ok,
            to_regclass('packages.package_variants')::text AS variants_ok`,
  );
  if (!schemaCheck.rows[0]?.packages_ok || !schemaCheck.rows[0]?.variants_ok) {
    return;
  }

  await pool.query(
    `INSERT INTO public."user" (id, email, role, name)
     VALUES ('test-user-id', 'test@ci.local', 'superuser', 'CI User')
     ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug)
     VALUES ($1, 'CI Workspace 210', 'ci-ws-210')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_ORG],
  );

  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE role = 'superuser' LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("integration test needs a real superuser in public.user");

  const rdb = await withRollbackDb(pool, SCHEMAS);
  db = rdb.db as unknown as PluginDb;
  rollback = rdb.rollback;

  const pkgRes = await db.query<{ id: number }>(
    `INSERT INTO packages.packages (workspace_id, name, type, effective_from, lineage_slug)
     VALUES ($1, 'Attribution Test Package', 'daily', CURRENT_DATE, 'attribution-test-pkg')
     RETURNING id`,
    [TEST_ORG],
  );
  variantPackageId = pkgRes.rows[0].id;

  const variantRes = await db.query<{ id: number }>(
    `INSERT INTO packages.package_variants
       (package_id, name, kind, duration_value, duration_unit, price, currency)
     VALUES ($1, 'Attribution Day Pass', 'standard', 1, 'day', 500.00, 'PHP')
     RETURNING id`,
    [variantPackageId],
  );
  variantRowId = variantRes.rows[0].id;

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
    await rollback();
  }
  await pool.end();
});

let seedCounter = 0;

// The source line's client_id (777) is deliberately DIFFERENT from the
// customer group's own client_id (501) — a multi-occupant booking can attach
// a line to a person other than the group's primary client. Making them
// differ proves /extend copies the LINE's client_id column, not something it
// re-derives from the customer group.
const SOURCE_LINE_CLIENT_ID = 777;
const CUSTOMER_GROUP_CLIENT_ID = 501;

/** Inserts a parent transaction + one customer group + one source line, all attributed to a specific client. */
async function seedAttributedBooking(): Promise<{
  transactionId: number;
  customerGroupId: number;
  lineItemId: number;
}> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date,
        status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE, 'completed', $3, 500, 0)
     RETURNING id`,
    [TEST_ORG, `extend-attribution-test-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const cgRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, client_id, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, $3, 'Payer', 500, 0, TRUE)
     RETURNING id`,
    [transactionId, TEST_ORG, CUSTOMER_GROUP_CLIENT_ID],
  );
  const customerGroupId = cgRes.rows[0].id;

  const liRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, client_id, customer_group_id)
     VALUES ($1, $2, $3, 'Day 1', 1, 500, 1, 'day', NOW(), NOW() + INTERVAL '1 day', 'active', $4, $5)
     RETURNING id`,
    [transactionId, TEST_ORG, variantPackageId, SOURCE_LINE_CLIENT_ID, customerGroupId],
  );

  return { transactionId, customerGroupId, lineItemId: liRes.rows[0].id };
}

describe("POST /:id/extend inherits the source line's customer_group_id + client_id (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("anchor omitted: the new line copies the source line's customer_group_id and client_id", async () => {
    if (!ready) return;
    const { customerGroupId, lineItemId } = await seedAttributedBooking();

    const res = await request(honoApp, "POST", `/api/transaction-line-items/${lineItemId}/extend`, {
      package_variant_id: variantRowId,
      quantity: 1,
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.customer_group_id).toBe(customerGroupId);
    expect(body.client_id).toBe(SOURCE_LINE_CLIENT_ID);
    expect(body.client_id).not.toBe(CUSTOMER_GROUP_CLIENT_ID);
  });

  it("anchor 'chain' explicit: the new line copies the source line's customer_group_id and client_id", async () => {
    if (!ready) return;
    const { customerGroupId, lineItemId } = await seedAttributedBooking();

    const res = await request(honoApp, "POST", `/api/transaction-line-items/${lineItemId}/extend`, {
      package_variant_id: variantRowId,
      quantity: 1,
      anchor: "chain",
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.customer_group_id).toBe(customerGroupId);
    expect(body.client_id).toBe(SOURCE_LINE_CLIENT_ID);
    expect(body.client_id).not.toBe(CUSTOMER_GROUP_CLIENT_ID);
  });
});
