import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb, PluginAssets } from "@kahitsan/plugin-sdk";
import { makeDataSurface } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes-accounts.js";
import { withRollbackDb, stubMiddleware } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";

// The /logo/raw route streams whatever s3GetObject returns. There's no live object
// store in tests, so mock it to a fixed PNG; s3KeyFromUrl stays real (it recovers
// the key from the row's s3_link). Everything else in the module is untouched.
// vi.mock is hoisted above module init, so the mock fn + fixture must be created in
// vi.hoisted() (which also hoists) rather than as plain top-level consts.
const { RAW_BYTES, s3GetObjectMock } = vi.hoisted(() => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
  return {
    RAW_BYTES: bytes,
    s3GetObjectMock: vi.fn().mockResolvedValue({ body: bytes, contentType: "image/png" }),
  };
});
// One vi.mock per module (vitest keys by specifier): the cross-plugin RPC
// override (fetchBalances → null when transactions is absent) and the s3GetObject
// stub share a single @kahitsan/plugin-sdk factory.
vi.mock("@kahitsan/plugin-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kahitsan/plugin-sdk")>();
  return {
    ...actual,
    tryCallPlugin: vi.fn().mockResolvedValue(null),
    s3GetObject: s3GetObjectMock,
  };
});

// ctx.assets stub — `upload` records the ledger row; `delete` is spied for the
// idempotency check. (`presign` is unused now but kept to satisfy the interface.)
const deleteSpy = vi.fn().mockResolvedValue(undefined);
const assetsStub: PluginAssets = {
  upload: async () => ({
    id: 999,
    objectKey: "uploads/x.webp",
    fileName: "logo.webp",
    fileSize: 1,
    mimeType: "image/webp",
  }),
  presign: async (assetId: number) => ({
    presignedUrl: `https://presigned.example/${assetId}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
  }),
  delete: deleteSpy,
};

// Every run seeds its OWN pair of workspaces — no fixed ids 3/4 (real prod
// tenants in the shared DB) collide with real data.
// eslint-disable-next-line sonarjs/pseudo-random -- test-only uniqueness, not unpredictability
const RUN_ID = 1_000_000 + Math.floor(Math.random() * 800_000_000);
const WS_A = RUN_ID;
const WS_B = RUN_ID + 1;
const ALL_PERMISSIONS = [
  "financial_accounts.view",
  "financial_accounts.create",
  "financial_accounts.edit",
  "financial_accounts.delete",
];

const CTX_A = { wsId: WS_A, userId: `u-${WS_A}`, role: "superuser", wsRole: "admin" };
const CTX_B = { wsId: WS_B, userId: `u-${WS_B}`, role: "superuser", wsRole: "admin" };

let rdb: { db: PluginDb; rollback: () => Promise<void> };
let pool: pg.Pool;
let appA: Hono;
let appB: Hono;

function buildAppFor(wsId: number): Hono {
  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: wsId,
    userId: `u-${wsId}`,
    role: "superuser",
    wsRole: "admin",
    permissions: ALL_PERMISSIONS,
  });
  const router = buildRouter({
    db: rdb.db,
    requireAuth,
    requireWorkspace,
    requirePermission,
    assets: assetsStub,
  });
  const app = new Hono();
  app.use("*", (_c, next) =>
    runWithTenantContext({ wsId, userId: `u-${wsId}`, role: "superuser", wsRole: "admin" }, () => next()),
  );
  app.route("/", router);
  return app;
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
  // The asset_id column ships in a migration applied on plugin boot; the test DB
  // may predate it, so ensure it idempotently (same statement as the migration).
  await pool.query(
    "ALTER TABLE accounts.financial_accounts ADD COLUMN IF NOT EXISTS asset_id integer"
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug)
     VALUES ($1, 'WS A', $2), ($3, 'WS B', $4)
     ON CONFLICT (id) DO NOTHING`,
    [WS_A, `ci-ws-${WS_A}`, WS_B, `ci-ws-${WS_B}`],
  );

  rdb = await withRollbackDb(pool, ["accounts"]);
  appA = buildAppFor(WS_A);
  appB = buildAppFor(WS_B);
});

afterAll(async () => {
  await rdb.rollback();
  await pool.end();
});

// Helper: set s3_link / asset_id directly on a row inside WS A's tenant context.
async function patchRow(
  id: number,
  fields: { s3_link?: string | null; asset_id?: number | null }
): Promise<void> {
  await runWithTenantContext(CTX_A, async () => {
    const data = makeDataSurface(rdb.db);
    await data.update(
      "financial_accounts",
      { ...fields, updated_at: new Date() },
      { where: "id = $1", params: [id] },
      ["id"]
    );
  });
}

describe("GET /:id/logo/raw — A1 proxy/blob logo streaming", () => {
  let acctId: number;

  beforeAll(async () => {
    const res = await runWithTenantContext(CTX_A, () =>
      appA.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: `raw-acct-${Date.now()}`, type: "bank" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    acctId = body.id;
  });

  it("400s on a non-numeric id", async () => {
    const res = await runWithTenantContext(CTX_A, () => appA.request("/abc/logo/raw"));
    expect(res.status).toBe(400);
  });

  it("404s when the account has no logo (no s3_link)", async () => {
    const res = await runWithTenantContext(CTX_A, () => appA.request(`/${acctId}/logo/raw`));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No logo");
  });

  it("streams the object's bytes with its content-type when s3_link is set", async () => {
    await patchRow(acctId, {
      s3_link: `https://cdn.example.com/uploads/financial-accounts/${WS_A}/logo.webp`,
      asset_id: 999,
    });
    const res = await runWithTenantContext(CTX_A, () => appA.request(`/${acctId}/logo/raw`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body).toEqual(RAW_BYTES);
  });

  it("returns bytes, never a JSON url/source field (no public or signed URL leaks)", async () => {
    const res = await runWithTenantContext(CTX_A, () => appA.request(`/${acctId}/logo/raw`));
    expect(res.headers.get("content-type")).not.toContain("application/json");
  });

  it("is workspace-scoped — another workspace cannot read the logo (404)", async () => {
    const res = await runWithTenantContext(CTX_B, () => appB.request(`/${acctId}/logo/raw`));
    expect(res.status).toBe(404);
  });

  it("DELETE /:id/logo is idempotent when asset_id is null (no ledger call)", async () => {
    await patchRow(acctId, { s3_link: null, asset_id: null });
    deleteSpy.mockClear();
    const res = await runWithTenantContext(CTX_A, () =>
      appA.request(`/${acctId}/logo`, { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
