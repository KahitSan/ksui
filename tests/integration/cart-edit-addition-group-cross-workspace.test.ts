import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { withRollbackDb, stubMiddleware, type FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";
import { request } from "./cart-edit-fixtures.js";

// An addition's customer_group_id must belong to THIS transaction — the
// existsRes lookup in transactions-cart-edit.ts filters on
// `transaction_id = $2 AND workspace_id = $3` together, so a group id that
// resolves in a DIFFERENT workspace (even though the URL's transaction id is
// valid and owned by the caller's own workspace) must 404, not leak past the
// workspace_id half of that AND. Matches the cart-reduction-cross-tenant
// .leak.test.ts convention.

// The group-membership 404 fires before the addition's items are inserted,
// but AFTER the pre-BEGIN variant RPC — so the mocked variant must resolve,
// or the request would 503 on "packages plugin not available" first and
// never reach the branch under test.
vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async (ids: number[]) =>
    ids.map((id) => ({
      id,
      package_id: 1,
      name: "Mock Variant",
      kind: "standard",
      price: "500.00",
      currency: "PHP",
      duration_value: "1",
      duration_unit: "hour",
      is_active: true,
    })),
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async () => null,
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const WS_A = 332;
const WS_B = 333;

let honoAppA: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ownTxnId: number;
let ownLineId: number;
let foreignGroupId: number;

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
    `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, 'CI Workspace A332', 'ci-ws-332')
       ON CONFLICT (id) DO NOTHING`,
    [WS_A],
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, 'CI Workspace B333', 'ci-ws-333')
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

  const ownTxnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, 'cart-edit-cross-ws-own', CURRENT_DATE, 'completed', $2, 500, 0)
     RETURNING id`,
    [WS_A, userId],
  );
  ownTxnId = ownTxnRes.rows[0].id;
  const ownLineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, description, quantity, unit_price, duration_value, duration_unit, started_at, ends_at, status)
     VALUES ($1, $2, 'A line', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed')
     RETURNING id`,
    [ownTxnId, WS_A],
  );
  ownLineId = ownLineRes.rows[0].id;

  const foreignTxnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, 'cart-edit-cross-ws-foreign', CURRENT_DATE, 'completed', $2, 500, 0)
     RETURNING id`,
    [WS_B, userId],
  );
  const foreignTxnId = foreignTxnRes.rows[0].id;
  const foreignGroupRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Foreign Payer', 0, 0, TRUE) RETURNING id`,
    [foreignTxnId, WS_B],
  );
  foreignGroupId = foreignGroupRes.rows[0].id;

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

describe("POST /:id/apply-cart-edit — addition.customer_group_id from a different workspace (real Postgres)", () => {
  it("404s and mutates nothing when the group belongs to a transaction in a different workspace", async () => {
    const res = await request(honoAppA, "POST", `/${ownTxnId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Attempted cross-workspace group attribution",
      additions: [
        {
          customer_group_id: foreignGroupId,
          items: [{ package_variant_id: 1, quantity: 1, anchor: "now" }],
        },
      ],
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("customer_group_id must belong to this transaction");

    const lineRow = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [ownLineId],
    );
    expect(lineRow.rows[0].status).toBe("completed");

    const linesAfter = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_line_items WHERE transaction_id = $1`,
      [ownTxnId],
    );
    expect(linesAfter.rows[0].n).toBe("1");

    const editsAfter = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1`,
      [ownTxnId],
    );
    expect(editsAfter.rows[0].n).toBe("0");
  });
});
