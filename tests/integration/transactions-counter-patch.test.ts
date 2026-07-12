import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { todayInOrgTimezone } from "../../server/lib/backdate.js";
import { withRollbackDb, stubMiddleware, type FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";

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

// Same graceful-degradation posture as transactions-forfeit.test.ts — this
// suite only exercises the counter-patch write path against a real Postgres.
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

const TEST_ORG = 4;
const SCHEMAS = ["accounts"];

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
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
     VALUES (4, 'CI Workspace 4', 'CI Workspace 4')
     ON CONFLICT (id) DO NOTHING`,
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
    permissions: [
      "transactions.view",
      "transactions.create",
      "transactions.edit",
      "transactions.delete",
    ],
  });
  const router = buildRouter({
    db: rdb.db as unknown as PluginDb,
    requireAuth,
    requireWorkspace,
    requirePermission,
  });
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
  await rollback();
  await pool.end();
});

describe("PATCH /:id/customer-group-started-at (real Postgres)", () => {
  const desc = `integ-counter-patch-${Date.now()}`;
  let txnId: number;
  let customerGroupId: number;
  let lineId: number;

  it("creates a sale to attach a customer group + line item to", async () => {
    const res = await request(honoApp, "POST", "/", {
      category: "sale",
      amount: "100.00",
      description: desc,
      transaction_date: todayInOrgTimezone(),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    txnId = body.id;
  });

  it("seeds a completed line item under a customer group", async () => {
    const cg = await db.query<{ id: number }>(
      `INSERT INTO accounts.transaction_customer_groups (transaction_id, workspace_id, display_name, is_payer)
       VALUES ($1, $2, 'Walk-in', TRUE) RETURNING id`,
      [txnId, TEST_ORG],
    );
    customerGroupId = cg.rows[0].id;
    const line = await db.query<{ id: number }>(
      `INSERT INTO accounts.transaction_line_items
         (transaction_id, workspace_id, customer_group_id, description, quantity, unit_price,
          status, duration_value, duration_unit, started_at, ends_at)
       VALUES ($1, $2, $3, 'Test Room', 1, 100.00, 'completed', 1, 'hour', NOW() - INTERVAL '2 hour', NOW() - INTERVAL '1 hour')
       RETURNING id`,
      [txnId, TEST_ORG, customerGroupId],
    );
    lineId = line.rows[0].id;
    expect(lineId).toBeGreaterThan(0);
  });

  it("rescheduling a completed line's start into the future reopens it to active", async () => {
    const futureStart = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await request(honoApp, "PATCH", `/${txnId}/customer-group-started-at`, {
      updates: [{ customer_group_id: customerGroupId, started_at: futureStart }],
      reason: "Guest asked to push back their slot",
    });
    expect(res.status).toBe(200);
    const line = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(line.rows[0].status).toBe("active");
  });

  it("backdating a completed line's start into the past leaves status untouched", async () => {
    await db.query(`UPDATE accounts.transaction_line_items SET status = 'completed' WHERE id = $1`, [lineId]);
    const pastStart = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const res = await request(honoApp, "PATCH", `/${txnId}/customer-group-started-at`, {
      updates: [{ customer_group_id: customerGroupId, started_at: pastStart }],
      reason: "Correcting a typo'd start time",
    });
    expect(res.status).toBe(200);
    const line = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(line.rows[0].status).toBe("completed");
  });

  it("rejects a bogus customer_group_id with 404 and writes no audit row", async () => {
    const before = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1`,
      [txnId],
    );
    const res = await request(honoApp, "PATCH", `/${txnId}/customer-group-started-at`, {
      updates: [{ customer_group_id: 999999999, started_at: new Date().toISOString() }],
      reason: "Should not match anything",
    });
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe("Customer group not found");
    const after = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1`,
      [txnId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
