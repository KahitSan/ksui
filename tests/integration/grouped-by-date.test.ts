import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { todayInOrgTimezone } from "../../server/lib/backdate.js";
import { withRollbackDb, stubMiddleware } from "@kahitsan/plugin-sdk/test";
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

const TEST_ORG = 3;
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

// Regression guard: "grouped-by-date" has no /:id-shaped segment, so before a
// real /grouped-by-date route existed the request fell through to GET /:id and
// died with `invalid input syntax for type integer: "grouped-by-date"` (500).
// The route must win the match (200) AND its per-day aggregate must agree with
// the sales drilldown the UI expands each day into.
describe("grouped-by-date aggregate (real Postgres)", () => {
  const today = todayInOrgTimezone();

  beforeAll(async () => {
    // Two known sales today so the aggregate is non-vacuous even on an empty CI DB.
    for (const amount of ["100.00", "250.00"]) {
      const res = await request(honoApp, "POST", "/", {
        category: "sale",
        amount,
        description: `grouped-by-date-fixture-${amount}`,
        transaction_date: today,
      });
      expect(res.status).toBe(201);
    }
  });

  it("returns 200 with the {data,total} shape — never falls through to /:id", async () => {
    const res = await request(honoApp, "GET", "/grouped-by-date?status=active");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  it("per-day count + total match the sales drilldown for that day", async () => {
    const grouped = await (
      await request(honoApp, "GET", "/grouped-by-date?status=active&limit=200")
    ).json();
    const day = (
      grouped.data as Array<{ date: string; count: number; total: string; currency: string }>
    ).find((d) => d.date === today);
    expect(day, "today's fixtures must produce a grouped row").toBeTruthy();
    expect(day!.count).toBeGreaterThanOrEqual(2);
    expect(day!.currency).toBe("PHP");

    // The drilldown the UI opens per day: sales-only, single-day window.
    const drill = await (
      await request(
        honoApp,
        "GET",
        `/?category=sale&status=active&dateFrom=${today}&dateTo=${today}&limit=200`,
      )
    ).json();
    expect(day!.count).toBe(drill.total);
    const drillSum = (drill.data as Array<{ amount: string }>).reduce(
      (s, r) => s + Number(r.amount),
      0,
    );
    expect(Number(day!.total)).toBeCloseTo(drillSum, 2);
  });
});
