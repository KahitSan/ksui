import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { makeDatabaseService, makeDataSurface, runWithTenantContext } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { withRollbackDb, stubMiddleware } from "@kahitsan/plugin-sdk/test";

// ── Gate-4b cross-subsystem smoke (transactions) ─────────────────────────────
//
// Proves, against a REAL Postgres, that the three rearch subsystems compose on
// the most complex reference plugin and that every adversarial path FAILS CLOSED
// SERVER-SIDE — not in the UI:
//
//   roles      → the kernel-signed identity carries `permissions[]`; the route's
//                `requirePermission("transactions.view")` gate refuses a
//                principal that lacks the code (403), independent of any client.
//   consent    → the plugin's manifest `exposes` block declares `transactions:read`
//                (grants:['transactions.view'], route GET /api/transactions) and
//                `transactions:capacity` (risk low). The kernel consent gate
//                (decideConsent / isGrantedByDelegation) lives in kserp and is NOT
//                importable from a plugin; what IS reachable is the capability's
//                OWN enforcement surface — the gated route + the workspace clamp —
//                which is what this suite exercises. See `notes` for the gap.
//   transport  → the request rides through the real Hono router the kernel proxy
//                mounts in prod (buildRouter), so the assertions are on the wire
//                shape, not an in-process function call.
//
// The data wall is the route's explicit `AND workspace_id = $N` — the ONLY tenant
// gate that holds for a process-isolated plugin (the stub establishes no tenant
// ALS, so RLS is dormant on the route path; the RLS wall itself is proven
// separately in transactions.leak.test.ts). To also assert the capability path
// under a REAL tenant context (RLS engaged), this suite adds a surface-level
// positive + cross-workspace pair via makeDataSurface + runWithTenantContext,
// mirroring the leak test.
//
// Peer name resolution is out of scope (same posture as transactions-flow):
// every cross-plugin resolver returns its degraded null.
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

const TAG = "__gate4b_smoke__";
const SCHEMAS = ["accounts"];

let pool: pg.Pool;
let rollback: () => Promise<void>;
let rdbDb: PluginDb;

// Two distinct workspaces (W = the principal's, V = the foreign one) + a user.
let wsW = 0;
let wsV = 0;
let userId = "";
let wRowId = 0;
let vRowId = 0;

// One Hono app per identity — stubMiddleware binds a FIXED identity, so a
// different workspace / permission set needs its own router instance over the
// SAME rollback db (all reads/writes share the one outer transaction).
let appW: Hono;
let appV: Hono;
let appNoPerm: Hono;

let ready = false;

function mountApp(workspaceId: number, permissions: string[]): Hono {
  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId,
    userId,
    role: "member",
    wsRole: "admin", // admin wsRole ⇒ privacyClause bypass, so the read isn't masked by share-grants
    permissions,
  });
  const router = buildRouter({
    db: rdbDb,
    requireAuth,
    requireWorkspace,
    requirePermission,
  });
  const honoApp = new Hono();
  honoApp.use("*", (_c, next) =>
    runWithTenantContext(
      { wsId: workspaceId, userId, role: "member", wsRole: "admin" },
      () => next(),
    ),
  );
  honoApp.route("/", router);
  return honoApp;
}

/** Convenience: make a GET request against a Hono app and parse JSON. */
async function GET(app: Hono, path: string, init?: RequestInit) {
  const res = await app.request(path, init);
  const body = await res.json().catch(() => undefined);
  return { status: res.status, body };
}

beforeAll(async () => {
  pool = new pg.Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "ks_erp",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    max: 3,
  });

  // The route path + RLS path both need a real table; bail to a no-op skip if
  // the migration hasn't run (bare DB) so the suite never false-fails.
  const tableOk = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema='accounts' AND table_name='transactions'
     ) AS exists`,
  );
  if (!tableOk.rows[0]?.exists) return;

  // Seed kernel rows on the raw pool (committed) so FK references succeed, then
  // resolve the user id. Idempotent.
  await pool.query(
    `INSERT INTO public."user" (id, email, role, name)
     VALUES ('gate4b-user', 'gate4b@ci.local', 'member', 'Gate4b User')
     ON CONFLICT DO NOTHING`,
  );
  const usr = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" ORDER BY id LIMIT 1`,
  );
  userId = usr.rows[0]?.id ?? "gate4b-user";

  // Two real workspaces. Prefer two that already exist (prod snapshot); fall
  // back to seeding a dedicated pair so CI's empty DB still has W != V.
  const ws = await pool.query<{ id: number }>(`SELECT id FROM workspaces ORDER BY id LIMIT 2`);
  if (ws.rows.length >= 2) {
    wsW = ws.rows[0].id;
    wsV = ws.rows[1].id;
  } else {
    await pool.query(
      `INSERT INTO public.workspaces (id, name, slug)
       VALUES (910001, 'Gate4b W', 'gate4b-w'), (910002, 'Gate4b V', 'gate4b-v')
       ON CONFLICT (id) DO NOTHING`,
    );
    wsW = 910001;
    wsV = 910002;
  }

  const rdb = await withRollbackDb(pool, SCHEMAS);
  rollback = rdb.rollback;
  rdbDb = rdb.db as unknown as PluginDb;

  // Seed one transaction per workspace INSIDE the rollback transaction so the
  // route reads (which share the same client) see them, and afterAll discards
  // them. The `WHERE workspace_id` column is the gate under test, so each row
  // is pinned to its workspace explicitly.
  const w = await rdbDb.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, amount, description, transaction_date, created_by)
       VALUES ($1, 'expense', 1, $2, CURRENT_DATE, $3) RETURNING id`,
    [wsW, `${TAG}-W`, userId],
  );
  const v = await rdbDb.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, amount, description, transaction_date, created_by)
       VALUES ($1, 'expense', 1, $2, CURRENT_DATE, $3) RETURNING id`,
    [wsV, `${TAG}-V`, userId],
  );
  wRowId = w.rows[0].id;
  vRowId = v.rows[0].id;

  appW = mountApp(wsW, ["transactions.view"]);
  appV = mountApp(wsV, ["transactions.view"]);
  appNoPerm = mountApp(wsW, ["clients.view"]); // a real code from another plugin — NOT transactions.view

  ready = wsW !== wsV;
});

afterAll(async () => {
  if (rollback) await rollback(); // discards both seeded rows
  if (pool) await pool.end();
});

describe("Gate-4b: roles + consent + transport compose on transactions (real Postgres)", () => {
  it("has the prerequisites (two distinct workspaces + seeded rows), else no-op skip", () => {
    if (!ready) return;
    expect(wsW).not.toBe(wsV);
    expect(wRowId).toBeGreaterThan(0);
    expect(vRowId).toBeGreaterThan(0);
  });

  // ── (a) POSITIVE ──────────────────────────────────────────────────────────
  // A valid signed identity WITH transactions.view, in workspace W, resolves the
  // read capability (transactions:read = GET /api/transactions) and sees ONLY
  // W's rows. The capability "resolves" = the gated route returns 200 with data.
  it("(a) principal with transactions.view in W reads the list capability and sees only W's row", async () => {
    if (!ready) return;
    const term = `${TAG}-`;
    const { status, body } = await GET(appW, `/?search=${encodeURIComponent(term)}`);
    expect(status).toBe(200);
    const rows = body.data as Array<{ id: number; workspace_id: number; description: string }>;
    // The W row is present…
    expect(rows.some((r) => r.id === wRowId)).toBe(true);
    // …and NOTHING from V leaked into W's list.
    expect(rows.every((r) => r.workspace_id === wsW)).toBe(true);
    expect(rows.some((r) => r.id === vRowId)).toBe(false);
  });

  it("(a) the same principal resolves W's row on the detail capability (GET /:id ⇒ 200)", async () => {
    if (!ready) return;
    const { status, body } = await GET(appW, `/${wRowId}`);
    expect(status).toBe(200);
    expect(body.id).toBe(wRowId);
    expect(body.workspace_id).toBe(wsW);
  });

  // ── (b) NEGATIVE — ungranted capability ─────────────────────────────────────
  // A principal WITHOUT transactions.view is refused SERVER-SIDE by
  // requirePermission (403), not by the UI. This is the consent-gate analogue
  // for the manifest's grants:['transactions.view'] on transactions:read — the
  // capability does not resolve when the principal doesn't hold the granting
  // permission.
  it("(b) principal WITHOUT transactions.view is refused (403) on the read capability", async () => {
    if (!ready) return;
    const { status, body } = await GET(appNoPerm, "/");
    expect(status).toBe(403);
    expect(body.error).toContain("transactions.view");
  });

  it("(b) the same ungranted principal is refused (403) on the detail capability too", async () => {
    if (!ready) return;
    const { status } = await GET(appNoPerm, `/${wRowId}`);
    expect(status).toBe(403);
  });

  // ── (c) NEGATIVE — cross-workspace ──────────────────────────────────────────
  // Identity for workspace W cannot read workspace V's transaction even when it
  // names V's id directly — the route's `AND workspace_id = $N` clamps it to a
  // 404. The leak is closed on the capability path, server-side.
  it("(c) W's principal canNOT read V's transaction by id (cross-workspace ⇒ 404)", async () => {
    if (!ready) return;
    const { status } = await GET(appW, `/${vRowId}`);
    expect(status).toBe(404);
  });

  it("(c) V's row is invisible to W's list even with a matching search term", async () => {
    if (!ready) return;
    const termV = `${TAG}-V`;
    const { status, body } = await GET(appW, `/?search=${encodeURIComponent(termV)}`);
    expect(status).toBe(200);
    const rows = body.data as Array<{ id: number }>;
    expect(rows.some((r) => r.id === vRowId)).toBe(false);
  });

  // The mirror: V's OWN principal DOES see V's row — proves (c)'s emptiness is
  // the workspace clamp biting, not a vacuously-broken query.
  it("(c) V's own principal sees V's row (clamp bites by workspace, not by accident)", async () => {
    if (!ready) return;
    const { status, body } = await GET(appV, `/${vRowId}`);
    expect(status).toBe(200);
    expect(body.id).toBe(vRowId);
    expect(body.workspace_id).toBe(wsV);
  });

  // ── (d) NEGATIVE — forged / zero delegation ─────────────────────────────────
  // The kernel's isGrantedByDelegation (consent-gate.integration.test.ts in
  // kserp) requires the user to ACTUALLY hold the orchestrator permission for a
  // delegationMarker to grant a capability — a forged marker grants nothing.
  // That gate is kernel-internal and NOT importable from a plugin (see notes).
  // The reachable equivalent: a principal whose signed permissions[] simply
  // lacks transactions.view is rejected at requirePermission — a forged client
  // claim of the capability cannot manufacture the code server-side, because the
  // route reads the kernel-verified permissions[], never a request-supplied one.
  it("(d) a forged client header claiming the grant does NOT bypass the server gate (403)", async () => {
    if (!ready) return;
    // appNoPerm's identity carries NO transactions.view; a client cannot inject
    // it — these headers are advisory and never feed requirePermission, which
    // reads only the kernel-verified permissions[].
    const { status, body } = await GET(appNoPerm, "/", {
      headers: {
        "x-permissions": "transactions.view",
        "x-ks-grant": "transactions:read",
      },
    });
    expect(status).toBe(403);
    expect(body.error).toContain("transactions.view");
  });

  // ── Surface/RLS capability path (real tenant context engaged) ───────────────
  // The route assertions above run with NO tenant ALS (stub posture), so the
  // gate proven there is the explicit workspace clamp. Here the capability's
  // data layer is exercised under a REAL tenant context so the RLS wall also
  // bites — mirroring transactions.leak.test.ts but framed as the capability's
  // read surface. NOTE: this uses a SEPARATE non-rollback pool connection so the
  // tenant transaction (SET LOCAL ROLE app_authenticated) doesn't collide with
  // the outer rollback client; rows are read by the TAG seeded above, which are
  // visible only inside the rollback txn — so we seed a committed-then-deleted
  // pair on this pool instead.
  it("(a/c surface) read under W's tenant context sees W and not V (RLS engaged)", async () => {
    if (!ready) return;
    const hasRls = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_policies
          WHERE schemaname='accounts' AND tablename='transactions'
            AND policyname='transactions_org_isolation'
       ) AS exists`,
    );
    if (!hasRls.rows[0]?.exists) return; // RLS not provisioned ⇒ skip this leg

    const seedW = await pool.query<{ id: number }>(
      `INSERT INTO accounts.transactions
         (workspace_id, category, amount, description, transaction_date, created_by)
         VALUES ($1, 'expense', 1, $2, CURRENT_DATE, $3) RETURNING id`,
      [wsW, `${TAG}-rls-W`, userId],
    );
    const seedV = await pool.query<{ id: number }>(
      `INSERT INTO accounts.transactions
         (workspace_id, category, amount, description, transaction_date, created_by)
         VALUES ($1, 'expense', 1, $2, CURRENT_DATE, $3) RETURNING id`,
      [wsV, `${TAG}-rls-V`, userId],
    );
    const idW = seedW.rows[0].id;
    const idV = seedV.rows[0].id;
    try {
      const surface = () => makeDataSurface(makeDatabaseService(pool, ["accounts"]));
      const asW = <T>(fn: () => Promise<T>) =>
        runWithTenantContext({ wsId: wsW, userId, role: "member", wsRole: "member" }, fn);

      // POSITIVE: W's own row resolves.
      const ownRows = await asW(() =>
        surface().find<{ id: number; workspace_id: number }>(
          "transactions",
          ["id", "workspace_id"],
          { where: "id = $1", params: [idW] },
        ),
      );
      expect(ownRows.map((r) => r.workspace_id)).toEqual([wsW]);

      // CROSS-WORKSPACE: V's row is clamped out even when targeted by id.
      const foreignRows = await asW(() =>
        surface().find("transactions", ["id"], { where: "id = $1", params: [idV] }),
      );
      expect(foreignRows).toEqual([]);
    } finally {
      await pool.query(`DELETE FROM accounts.transactions WHERE id = ANY($1::int[])`, [[idW, idV]]);
    }
  });
});
