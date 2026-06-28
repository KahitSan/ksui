import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import request from "supertest";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { todayInOrgTimezone } from "../../server/lib/backdate.js";
import { withRollbackDb, stubMiddleware } from "@kahitsan/plugin-server-utils/test";

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
vi.mock("@kahitsan/plugin-server-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kahitsan/plugin-server-utils")>();
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

const TEST_ORG = 3;
const SCHEMAS = ["accounts"];

let app: any;
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
     VALUES (3, 'CI Workspace', 'CI Workspace')
     ON CONFLICT (id) DO NOTHING`,
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
  app = new Hono() as any;
    app.route("/", router);
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
    const res = await request(app).get("/export");
    const job = (res.body.jobs as Array<Record<string, unknown>>).find((j) => j.id === jobId);
    if (job && (job.status === "done" || job.status === "error")) return job;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`export job ${jobId} did not finish within ${timeoutMs}ms`);
}

describe("transactions CSV export: create → poll → download (real Postgres)", () => {
  const today = todayInOrgTimezone();
  const desc = `integ-export-${Date.now()}`;

  it("rejects an inverted date range", async () => {
    const res = await request(app)
      .post("/export")
      .send({ dateFrom: today, dateTo: "2000-01-01" });
    expect(res.status).toBe(400);
  });

  it("exports a detailed CSV that includes a freshly-created row", async () => {
    // Seed one row inside the export window so the assertion is meaningful even
    // on an empty CI database.
    const create = await request(app).post("/").send({
      category: "expense",
      amount: "42.50",
      description: desc,
      transaction_date: today,
    });
    expect(create.status).toBe(201);

    const start = await request(app)
      .post("/export")
      .send({ dateFrom: today, dateTo: today, consolidate: false });
    expect(start.status).toBe(200);
    const jobId = start.body.jobId as string;
    expect(typeof jobId).toBe("string");

    const job = await waitForJob(jobId);
    expect(job.status, JSON.stringify(job)).toBe("done");
    expect(job.filename).toContain(today);

    const dl = await request(app).get(`/export/${jobId}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toContain("text/csv");
    expect(dl.headers["content-disposition"]).toContain("attachment");
    // Header row + the seeded transaction's description must be present.
    expect(dl.text.startsWith("Date,Category,Subcategory,Description,Amount")).toBe(true);
    expect(dl.text).toContain(desc);
  });

  it("404s a download for an unknown job", async () => {
    const res = await request(app).get(
      "/export/00000000-0000-0000-0000-000000000000/download",
    );
    expect(res.status).toBe(404);
  });
});
