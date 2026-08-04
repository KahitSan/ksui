import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildLineItemsRouter } from "../../server/routes-line-items.js";
import { withRollbackDb, stubMiddleware, type FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";
import { todayInOrgTimezone } from "../../server/lib/backdate.js";

// Name resolution goes over the kernel RPC, which is absent in the test
// process — degrade gracefully the same way the other suites do.
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

async function request(
  app: Hono,
  path: string,
): Promise<{ status: number; json: () => Promise<any> }> {
  const res = await app.request(path);
  return { status: res.status, json: () => res.json() };
}

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
     VALUES ($1, 'CI Workspace', 'ci-ws-projection-default')
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

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: TEST_ORG,
    userId,
    role: "superuser",
    wsRole: "admin",
    permissions: ["transactions.view"],
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

  // A row must exist in the projection for the candidate probe to pass; the
  // line-item insert marks the key dirty, so drain it before the request.
  const txn = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date,
        status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 100, $2, CURRENT_DATE, 'completed', $3, 100, 0)
     RETURNING id`,
    [TEST_ORG, `proj-default-${Date.now()}`, userId],
  );
  await db.query(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status)
     VALUES ($1, $2, 'Room', 1, 100, 1, 'hour', NOW(), NOW() + INTERVAL '1 hour', 'active')`,
    [txn.rows[0].id, TEST_ORG],
  );
  await db.query(`SELECT accounts.process_availment_projection_dirty(10, $1)`, [TEST_ORG]);
  ready = true;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

describe("GET /api/transaction-line-items without a limit param", () => {
  it("serves through the projection path (has_more present in the response)", async () => {
    const res = await request(honoApp, `/api/transaction-line-items?active_on=${todayInOrgTimezone()}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("has_more");
  });
});
