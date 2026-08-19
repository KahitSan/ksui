import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { todayInOrgTimezone } from "../../server/lib/backdate.js";
import { withRollbackDb, stubMiddleware } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";

/** Make an HTTP request against a Hono app and return status + json accessor. */
async function request(
  app: Hono,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: () => Promise<unknown>; headers: Headers }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await app.request(path, init);
  return { status: res.status, json: () => res.json(), headers: res.headers };
}

// Same posture as transactions-flow: peer name resolution is out of scope, so
// every cross-plugin resolver returns its degraded null (the export then leaves
// the account/payee name cells blank, exactly like the list view does).
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

// In-memory S3: the export worker uploads the CSV and the download route
// re-fetches it. We don't need a real MinIO in CI — just a put/get pair that
// round-trips the bytes, with s3Enabled() forced on so POST /export proceeds.
const s3Store = new Map<string, Buffer>();
vi.mock("@kahitsan/plugin-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kahitsan/plugin-sdk")>();
  return {
    ...actual,
    s3Enabled: () => true,
    s3PutObject: async (key: string, body: Buffer) => {
      s3Store.set(key, Buffer.from(body));
    },
    s3GetObject: async (key: string) => {
      const b = s3Store.get(key);
      if (!b) throw new Error(`s3 mock: missing ${key}`);
      return { body: b, contentType: "text/csv; charset=utf-8" };
    },
    s3DeleteObject: async (key: string) => {
      s3Store.delete(key);
    },
  };
});

// Every run seeds its OWN workspace — no fixed id collides with real tenants
// in the shared snapshot DB, so the export only ever sees this run's rows.
// eslint-disable-next-line sonarjs/pseudo-random -- test-only uniqueness, not unpredictability
const RUN_ID = 1_000_000 + Math.floor(Math.random() * 800_000_000);
const TEST_ORG = RUN_ID;
const SCHEMAS = ["accounts"];

let honoApp: Hono;
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

// Poll the recent-jobs list until the job reaches a terminal state (the worker
// runs fire-and-forget after POST responds).
async function waitForJob(jobId: string, timeoutMs = 8000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(honoApp, "GET", "/export");
    const body = (await res.json()) as Record<string, unknown>;
    const job = (body.jobs as Array<Record<string, unknown>>).find((j) => j.id === jobId);
    if (job && (job.status === "done" || job.status === "error")) return job;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`export job ${jobId} did not finish within ${timeoutMs}ms`);
}

describe("transactions CSV export: create → poll → download (real Postgres)", () => {
  const today = todayInOrgTimezone();
  const desc = `integ-export-${Date.now()}`;

  it("rejects an inverted date range", async () => {
    const res = await request(honoApp, "POST", "/export", {
      dateFrom: today,
      dateTo: "2000-01-01",
    });
    expect(res.status).toBe(400);
  });

  it("exports a detailed CSV that includes a freshly-created row", async () => {
    // Seed one row inside the export window so the assertion is meaningful even
    // on an empty CI database.
    const create = await request(honoApp, "POST", "/", {
      category: "sale",
      amount: "42.50",
      description: desc,
      transaction_date: today,
      reference_number: "INV-TEST-1001",
    });
    expect(create.status).toBe(201);

    const start = await request(honoApp, "POST", "/export", {
      dateFrom: today,
      dateTo: today,
      consolidate: false,
    });
    const startBody = (await start.json()) as Record<string, unknown>;
    expect(start.status).toBe(200);
    const jobId = startBody.jobId as string;
    expect(typeof jobId).toBe("string");

    const job = await waitForJob(jobId);
    expect(job.status, JSON.stringify(job)).toBe("done");
    expect(job.filename).toContain(today);

    const dlRes = await honoApp.request(`/export/${jobId}/download`);
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("content-type")).toContain("text/csv");
    expect(dlRes.headers.get("content-disposition")).toContain("attachment");
    // Header row + the seeded transaction's description must be present.
    const dlText = await dlRes.text();
    expect(dlText.startsWith("Date,Invoice Number,Category,Subcategory,Description,Amount")).toBe(true);
    expect(dlText).toContain("INV-TEST-1001");
    expect(dlText).toContain(desc);
  });

  it("404s a download for an unknown job", async () => {
    const res = await request(
      honoApp,
      "GET",
      "/export/00000000-0000-0000-0000-000000000000/download",
    );
    expect(res.status).toBe(404);
  });
});
