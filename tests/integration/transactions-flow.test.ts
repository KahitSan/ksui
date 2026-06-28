import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { testClient } from "hono/testing";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { todayInOrgTimezone } from "../../server/lib/backdate.js";
import { withRollbackDb, stubMiddleware } from "@kahitsan/plugin-server-utils/test";
import { runWithTenantContext } from "@ks-erp/kernel/services/tenant-context";

// Peer hydration (package / variant / client / account / payee / voucher names
// resolved over the kernel RPC) is OUT OF SCOPE for this test — this suite is
// about the tenant-scoped CRUD flow against a real Postgres, not cross-plugin
// name resolution. Mock every peer resolver to its "plugin unavailable"
// degraded return (null), the SAME posture production takes when a peer plugin
// isn't loaded (see lib/peers.ts graceful-degradation contract). This keeps
// the test self-contained — it needs only Postgres, never a running kernel.
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

// Workspace 3 carries the richest real data in the prod snapshot (7877
// transactions, 7778 active) so the list/detail assertions are meaningful
// rather than vacuous. Every handler step exercises the route's explicit
// `WHERE workspace_id = $N` gate — the ONLY tenant gate that holds for a
// process-isolated plugin (RLS is dormant here).
const TEST_ORG = 3;
const SCHEMAS = ["accounts"];

let honoApp: Hono;
let client: ReturnType<typeof testClient>;
let pool: pg.Pool;
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

  // Seed kernel-level rows (user + workspace) so FK references succeed.
  // Migrations create the tables; tests seed the rows. Idempotent.
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

  // Resolve the superuser created by migrations+seeds. Done on the raw pool
  // BEFORE withRollbackDb opens the outer transaction.
  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE role = 'superuser' LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("integration test needs a real superuser in public.user");

  const rdb = await withRollbackDb(pool, SCHEMAS);
  rollback = rdb.rollback;
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
  // The F3 data surface reads the workspace from the ambient tenant context
  // (set by withTenantContext in prod). The stub middleware doesn't establish
  // that ALS scope, so wrap each request in runWithTenantContext here, matching
  // the stubbed identity, or the surface-backed routes fail-closed.
  honoApp.use("*", (_c, next) =>
    runWithTenantContext(
      { wsId: TEST_ORG, userId, role: "superuser", wsRole: "admin" },
      () => next(),
    ),
  );
  honoApp.route("/", router);
  client = testClient(honoApp);
});

afterAll(async () => {
  await rollback(); // discard every row the suite wrote
  await pool.end();
});

// The steps below are intentionally SEQUENTIAL and share state (newId) — they
// imitate the e2e journey they replace (record → view → void) at the API
// layer, in order, against the same rolled-back transaction.
describe("transactions flow: list → create → list → detail → void (real Postgres)", () => {
  const desc = `integ-flow-${Date.now()}`;
  let newId: number;

  it("lists existing transactions for the active org", async () => {
    const res = await client.get("/");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    // CI starts with an empty database; local dev may have prod data.
    expect(typeof body.total).toBe("number");
  });

  it("creates a manual expense scoped to the active org", async () => {
    const res = await client.post("/", {
      body: {
        category: "expense",
        amount: "99.99",
        description: desc,
        transaction_date: todayInOrgTimezone(), // PHT today ⇒ no backdate gate
      },
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(typeof body.id).toBe("number");
    newId = body.id;
  });

  it("the new transaction appears in the org-scoped list", async () => {
    const res = await client.get(`/?search=${encodeURIComponent(desc)}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    const found = (body.data as Array<{ id: number; description: string }>).find(
      (t) => t.description === desc,
    );
    expect(found, "created transaction must show in the list").toBeTruthy();
    expect(found?.id).toBe(newId);
  });

  it("opens detail with 200 + customer_groups (the regression contract)", async () => {
    const res = await client.get(`/${newId}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe(newId);
    // Mirrors the e2e guard: detail must not 500 on customer_group resolution.
    expect(Array.isArray(body.customer_groups)).toBe(true);
  });

  it("voids (soft-deletes) the transaction", async () => {
    const res = await client.delete(`/${newId}`);
    expect(res.status).toBe(204);
  });

  it("a voided transaction leaves the default active list", async () => {
    const res = await client.get(`/?search=${encodeURIComponent(desc)}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    const found = (body.data as Array<{ id: number }>).find((t) => t.id === newId);
    expect(found, "voided transaction must not appear in the active list").toBeUndefined();
  });
});
