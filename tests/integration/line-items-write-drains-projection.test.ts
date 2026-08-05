import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildLineItemsRouter } from "../../server/routes-line-items.js";
import { withRollbackDb, stubMiddleware, type FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";
import { todayInOrgTimezone } from "../../server/lib/backdate.js";

// Name resolution rides the kernel RPC, absent in the test process — a
// fixture variant lets the extend handler price the appended line, the rest
// degrade gracefully like the sibling suites.
vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async () => [
    { id: 524, package_id: 576, name: "1 Hour", duration_value: 1, duration_unit: "hour", price: 80 },
  ],
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async () => null,
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 3;
const SCHEMAS = ["accounts"];

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
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

  await pool.query(
    `INSERT INTO public."user" (id, email, role, name)
     VALUES ('test-user-id', 'test@ci.local', 'superuser', 'CI User')
     ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug)
     VALUES ($1, 'CI Workspace', 'ci-ws-projection-drain')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_ORG],
  );
  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE role = 'superuser' LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("integration test needs a real superuser in public.user");

  const rdb = await withRollbackDb(pool, SCHEMAS);
  rollback = rdb.rollback;
  db = rdb.db;

  // The extend handler resolves variants over the (mocked) kernel RPC, but
  // its INSERT carries package_id/package_variant_id. Where the packages
  // plugin's migrations have run (prod-shaped DBs) those columns carry a FK
  // to packages.packages, so seed the referenced rows there — CI runs only
  // finance migrations, where the FK is absent and the schema may not exist.
  const pkgTables = await rdb.db.query<{ exists: boolean }>(
    `SELECT to_regclass('packages.packages') IS NOT NULL AS exists`,
  );
  if (pkgTables.rows[0]?.exists) {
    await rdb.db.query(
      `INSERT INTO packages.packages (id, workspace_id, name, type, effective_from, lineage_slug)
       VALUES (576, $1, 'Proj Drain Pkg', 'hourly', CURRENT_DATE, 'proj-drain-lineage')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_ORG],
    );
    await rdb.db.query(
      `INSERT INTO packages.package_variants (id, package_id, name, duration_value, duration_unit, price)
       VALUES (524, 576, '1 Hour', 1, 'hour', 80)
       ON CONFLICT (id) DO NOTHING`,
    );
  }

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: TEST_ORG,
    userId,
    role: "superuser",
    wsRole: "admin",
    permissions: ["transactions.view", "transactions.edit"],
  });
  const router = buildLineItemsRouter({
    db: rdb.db as unknown as PluginDb,
    requireAuth,
    requireWorkspace,
    requirePermission,
  });
  honoApp = new Hono();
  honoApp.use("*", (_c, next) =>
    runWithTenantContext({ wsId: TEST_ORG, userId, role: "superuser", wsRole: "admin" }, () => next()),
  );
  honoApp.route("/", router);
  ready = true;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

describe("line-items writes drain the projection before responding", () => {
  it("leaves no pending dirty keys and the extension is immediately readable after POST /extend", async () => {
    const txnRes = await db.query<{ id: number }>(
      `INSERT INTO accounts.transactions
         (workspace_id, category, subcategory, amount, description, transaction_date,
          status, created_by, subtotal, discount_amount)
       VALUES ($1, 'sale', 'Sales - services', 80, $2, CURRENT_DATE, 'completed', $3, 80, 0)
       RETURNING id`,
      [TEST_ORG, `proj-drain-${Date.now()}`, "test-user-id"],
    );
    const txnId = txnRes.rows[0]!.id;
    const lineRes = await db.query<{ id: number }>(
      `INSERT INTO accounts.transaction_line_items
         (transaction_id, workspace_id, package_id, package_variant_id, description,
          quantity, unit_price, duration_value, duration_unit, started_at, ends_at, status)
       VALUES ($1, $2, 576, 524, 'Base', 1, 80, 1, 'hour',
               NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'active')
       RETURNING id`,
      [txnId, TEST_ORG],
    );
    const lineId = lineRes.rows[0]!.id;
    // The seed insert dirtied the key; drain it so the assertion below is
    // about the extend's own middleware, not setup.
    await db.query(`SELECT accounts.process_availment_projection_dirty(10, $1)`, [TEST_ORG]);

    const extend = await honoApp.request(`/api/transaction-line-items/${lineId}/extend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package_variant_id: 524, quantity: 1 }),
    });
    expect(extend.status).toBe(201);

    // The write's middleware must have reprojected before responding — a
    // read issued right after the response sees the extension line.
    const pending = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM accounts.availment_projection_dirty WHERE workspace_id = $1`,
      [TEST_ORG],
    );
    expect(pending.rows[0]!.n).toBe(0);

    const list = await honoApp.request(
      `/api/transaction-line-items?active_on=${todayInOrgTimezone()}&include_carryover=true&include_upcoming=true&include_voided=true`,
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: Array<{ transaction_id: number; line_status: string }> };
    const mine = body.data.filter((r) => r.transaction_id === txnId);
    expect(mine.filter((r) => r.line_status !== "voided")).toHaveLength(2);
  });
});
