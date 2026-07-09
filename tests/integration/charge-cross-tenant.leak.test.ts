import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { withRollbackDb, stubMiddleware, type FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";

// ── F5 cross-tenant destination_account_id leak test ─────────────────────────
//
// Proves POST /charge rejects a destination_account_id that belongs to
// ANOTHER workspace, against a real Postgres. destination_account_id is a
// soft (FK-less) ref into accounts.financial_accounts — without the app-level
// ownership assert in run-charge.ts, a workspace-A caller could point a sale
// at workspace B's account, corrupting B's balance with A's money and no DB
// constraint would ever catch it.

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

// Manual line items only (no package_variant_id, no voucher_code) so the
// packages/vouchers RPC branches never fire — the test needs only Postgres.
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

const WS_A = 3;
const WS_B = 4;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ownAccountId: number;
let otherAccountId: number;

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
    `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, 'CI Workspace A', 'ci-ws-a')
       ON CONFLICT (id) DO NOTHING`,
    [WS_A],
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, 'CI Workspace B', 'ci-ws-b')
       ON CONFLICT (id) DO NOTHING`,
    [WS_B],
  );

  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE role = 'superuser' LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("integration test needs a real superuser in public.user");

  const rdb = await withRollbackDb(pool, ["accounts"]);
  rollback = rdb.rollback;
  db = rdb.db;

  const ownRow = await db.query<{ id: number }>(
    `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
       VALUES ($1, 'CI Own Account', 'cash') RETURNING id`,
    [WS_A],
  );
  ownAccountId = ownRow.rows[0].id;
  const otherRow = await db.query<{ id: number }>(
    `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
       VALUES ($1, 'CI Other Workspace Account', 'cash') RETURNING id`,
    [WS_B],
  );
  otherAccountId = otherRow.rows[0].id;

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: WS_A,
    userId,
    role: "superuser",
    wsRole: "admin",
    permissions: ["transactions.view", "transactions.create"],
  });
  const router = buildRouter({
    db: rdb.db as unknown as PluginDb,
    requireAuth,
    requireWorkspace,
    requirePermission,
  });
  honoApp = new Hono();
  honoApp.use("*", (_c, next) =>
    runWithTenantContext({ wsId: WS_A, userId, role: "superuser", wsRole: "admin" }, () => next()),
  );
  honoApp.route("/", router);
});

afterAll(async () => {
  await rollback();
  await pool.end();
});

describe("POST /charge — cross-workspace destination_account_id (real Postgres)", () => {
  it("rejects a destination_account_id belonging to a different workspace (404, not 500)", async () => {
    const res = await request(honoApp, "POST", "/charge", {
      destination_account_id: otherAccountId,
      items: [{ description: "CI cross-tenant probe", quantity: 1, unit_price: 100 }],
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/destination_account_id/);

    // The row must never have landed — the check runs BEFORE the INSERT.
    const leaked = await pool.query(
      `SELECT 1 FROM accounts.transactions WHERE destination_account_id = $1 AND workspace_id = $2`,
      [otherAccountId, WS_A],
    );
    expect(leaked.rows).toHaveLength(0);
  });

  it("accepts a destination_account_id belonging to the caller's own workspace", async () => {
    const res = await request(honoApp, "POST", "/charge", {
      destination_account_id: ownAccountId,
      items: [{ description: "CI own-account charge", quantity: 1, unit_price: 100 }],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.transaction.destination_account_id).toBe(ownAccountId);
  });
});
