import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { todayInOrgTimezone } from "../../server/lib/backdate.js";
import { withRollbackDb, stubMiddleware, type FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";
import { TRANSACTION_COLS } from "../../server/routes/shared.js";

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

// Every run seeds its OWN workspace — no fixed id collides with real tenants
// in the shared snapshot DB, so the list/detail assertions are meaningful
// against this run's own seeded rows rather than any prod snapshot. Every
// handler step exercises the route's explicit `WHERE workspace_id = $N`
// gate — the ONLY tenant gate that holds for a process-isolated plugin (RLS
// is dormant here).
// eslint-disable-next-line sonarjs/pseudo-random -- test-only uniqueness, not unpredictability
const RUN_ID = 1_000_000 + Math.floor(Math.random() * 800_000_000);
const TEST_ORG = RUN_ID;
const SCHEMAS = ["accounts"];

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let transferSourceAccountId: number;
let transferDestinationAccountId: number;

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
     VALUES ($1, 'CI Workspace', $2)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_ORG, `ci-ws-${TEST_ORG}`],
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
  db = rdb.db;

  // The manual-create route now asserts source/destination_account_id belong
  // to the caller's workspace (assertOrgOwnsRow) — real rows are required so
  // the transfer-fee test below exercises the check instead of tripping it.
  const srcRow = await db.query<{ id: number }>(
    `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
       VALUES ($1, 'CI Transfer Source', 'cash') RETURNING id`,
    [TEST_ORG],
  );
  transferSourceAccountId = srcRow.rows[0].id;
  const dstRow = await db.query<{ id: number }>(
    `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
       VALUES ($1, 'CI Transfer Destination', 'cash') RETURNING id`,
    [TEST_ORG],
  );
  transferDestinationAccountId = dstRow.rows[0].id;

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
  const transferDesc = `integ-transfer-fee-${Date.now()}`;
  let newId: number;

  it("lists existing transactions for the active org", async () => {
    const res = await request(honoApp, "GET", "/");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    // CI starts with an empty database; local dev may have prod data.
    expect(typeof body.total).toBe("number");
  });

  it("creates a manual expense scoped to the active org", async () => {
    const res = await request(honoApp, "POST", "/", {
      category: "expense",
      amount: "99.99",
      description: desc,
      transaction_date: todayInOrgTimezone(), // PHT today ⇒ no backdate gate
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(typeof body.id).toBe("number");
    newId = body.id;
  });

  it("creates a transfer with a separate fee expense in the same workspace", async () => {
    const res = await request(honoApp, "POST", "/", {
      category: "business",
      source_account_id: transferSourceAccountId,
      destination_account_id: transferDestinationAccountId,
      amount: "500.00",
      transfer_fee_amount: "15.00",
      description: transferDesc,
      transaction_date: todayInOrgTimezone(),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.category).toBe("business");
    expect(body.transfer_fee_transaction_id).toEqual(expect.any(Number));
    expect(body.created_categories).toEqual(["business", "expense"]);

    const listRes = await request(
      honoApp,
      "GET",
      `/?search=${encodeURIComponent(transferDesc)}`,
    );
    const listBody = await listRes.json();
    expect(listRes.status).toBe(200);
    const matchingRows = (listBody.data as Array<{
      id: number;
      category: string;
      subcategory: string | null;
      amount: string;
      source_account_id: number | null;
      description: string;
    }>).filter((row) => row.description.includes(transferDesc));
    const transferRow = matchingRows.find((row) => row.id === body.id);
    const feeRow = matchingRows.find(
      (row) => row.id === body.transfer_fee_transaction_id,
    );
    expect(transferRow).toBeTruthy();
    expect(transferRow).toMatchObject({
      category: "business",
      source_account_id: transferSourceAccountId,
      description: transferDesc,
    });
    expect(parseFloat(transferRow!.amount)).toBe(500);
    expect(feeRow).toBeTruthy();
    expect(feeRow).toMatchObject({
      category: "expense",
      subcategory: "Other expense",
      source_account_id: transferSourceAccountId,
      description: `Transfer fee — ${transferDesc}`,
    });
    expect(parseFloat(feeRow!.amount)).toBe(15);
  });

  it("rejects a transfer with an oversized transfer_fee_amount (400, not a NUMERIC(12,2) overflow 500)", async () => {
    const res = await request(honoApp, "POST", "/", {
      category: "business",
      source_account_id: transferSourceAccountId,
      destination_account_id: transferDestinationAccountId,
      amount: "500.00",
      transfer_fee_amount: "100000000000",
      description: `${transferDesc}-oversized-fee`,
      transaction_date: todayInOrgTimezone(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/transfer_fee_amount must not exceed/);
  });

  it("the new transaction appears in the org-scoped list", async () => {
    const res = await request(honoApp, "GET", `/?search=${encodeURIComponent(desc)}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    const found = (body.data as Array<{ id: number; description: string }>).find(
      (t) => t.description === desc,
    );
    expect(found, "created transaction must show in the list").toBeTruthy();
    expect(found?.id).toBe(newId);
  });

  it("opens detail with 200 + customer_groups (the regression contract)", async () => {
    const res = await request(honoApp, "GET", `/${newId}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe(newId);
    // Mirrors the e2e guard: detail must not 500 on customer_group resolution.
    expect(Array.isArray(body.customer_groups)).toBe(true);
  });

  it("list and detail expose every accounts.transactions column (guards the t.* → explicit-column-list fix)", async () => {
    const listRes = await request(honoApp, "GET", `/?search=${encodeURIComponent(desc)}`);
    const listBody = await listRes.json();
    const listRow = (listBody.data as Array<Record<string, unknown>>).find((r) => r.id === newId);
    expect(listRow, "created transaction must show in the list").toBeTruthy();
    for (const col of TRANSACTION_COLS) {
      expect(listRow, `list row missing column ${col}`).toHaveProperty(col);
    }

    const detailRes = await request(honoApp, "GET", `/${newId}`);
    const detailBody = await detailRes.json();
    for (const col of TRANSACTION_COLS) {
      expect(detailBody, `detail row missing column ${col}`).toHaveProperty(col);
    }
  });

  it("voids (soft-deletes) the transaction", async () => {
    const res = await request(honoApp, "DELETE", `/${newId}`);
    expect(res.status).toBe(204);
  });

  it("a voided transaction leaves the default active list", async () => {
    const res = await request(honoApp, "GET", `/?search=${encodeURIComponent(desc)}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    const found = (body.data as Array<{ id: number }>).find((t) => t.id === newId);
    expect(found, "voided transaction must not appear in the active list").toBeUndefined();
  });
});
