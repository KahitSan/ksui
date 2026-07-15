import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { withRollbackDb, stubMiddleware, type FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";

// ── apply-cart-edit cross-tenant leak test ────────────────────────────────
//
// Proves POST /:id/apply-cart-edit can't reach a transaction that belongs to
// ANOTHER workspace, matching the .leak.test.ts convention used elsewhere in
// this suite (charge-cross-tenant.leak.test.ts, transaction-payments.leak.test.ts).

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

const WS_A = 47;
const WS_B = 48;

let honoAppA: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let otherWsTxnId: number;
let otherWsLineId: number;

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
    `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, 'CI Workspace A47', 'ci-ws-47')
       ON CONFLICT (id) DO NOTHING`,
    [WS_A],
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, 'CI Workspace B48', 'ci-ws-48')
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

  // Line item under workspace B — no package/variant needed since these are
  // both NULL-able and this suite only proves cross-tenant isolation, not
  // reduction math.
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, 'cross-tenant-cart-edit-target', CURRENT_DATE, 'completed', $2, 500, 0)
     RETURNING id`,
    [WS_B, "test-user-id"],
  );
  otherWsTxnId = txnRes.rows[0].id;
  const lineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, description, quantity, unit_price, duration_value, duration_unit, started_at, ends_at, status)
     VALUES ($1, $2, 'B line', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed')
     RETURNING id`,
    [otherWsTxnId, WS_B],
  );
  otherWsLineId = lineRes.rows[0].id;

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: WS_A,
    userId,
    role: "superuser",
    wsRole: "admin",
    permissions: ["transactions.view", "transactions.create", "transactions.edit", "transactions.delete"],
  });
  const router = buildRouter({
    db: rdb.db as unknown as PluginDb,
    requireAuth,
    requireWorkspace,
    requirePermission,
  });
  honoAppA = new Hono();
  honoAppA.use("*", (_c, next) =>
    runWithTenantContext({ wsId: WS_A, userId, role: "superuser", wsRole: "admin" }, () => next()),
  );
  honoAppA.route("/", router);
});

afterAll(async () => {
  await rollback();
  await pool.end();
});

describe("POST /:id/apply-cart-edit — cross-tenant leak (real Postgres)", () => {
  it("404s when a workspace-A caller targets workspace B's transaction id", async () => {
    const res = await request(honoAppA, "POST", `/${otherWsTxnId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Attempted cross-tenant reduction",
      reductions: [{ customer_group_id: null, package_id: 1, package_variant_id: 1, target_quantity: 0 }],
    });
    expect(res.status).toBe(404);

    const lineRow = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [otherWsLineId],
    );
    expect(lineRow.rows[0].status).toBe("completed");
  });
});
