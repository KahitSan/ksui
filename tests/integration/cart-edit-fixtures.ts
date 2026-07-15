// Shared setup for the apply-cart-edit test family (cart-reduction*.test.ts,
// line-item-void-recompute.test.ts) — every file needs the same real Postgres
// harness (buildRouter + a seeded package/variant pair, since
// package_variant_id carries a real FK), so it's factored out once rather
// than duplicated eight times.

import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { withRollbackDb, stubMiddleware, type FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";

// vi.mock("../../server/lib/peers.js", ...) must stay a top-level, hoisted
// call in EACH test file (vitest hoists it above imports) — this module
// itself imports routes.js eagerly, so a mock installed only here would run
// too late to intercept that import.

export async function request(
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

export interface CartEditFixtures {
  honoApp: Hono;
  pool: pg.Pool;
  db: FakePluginDb;
  rollback: () => Promise<void>;
  ready: boolean;
  packageId: number;
  variantAId: number;
  variantBId: number;
}

export async function setupCartEditFixtures(testOrg: number, wsSlug: string): Promise<CartEditFixtures> {
  const pool = new pg.Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "ks_erp",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    max: 3,
  });

  // package_variant_id carries a real FK into packages.package_variants — a
  // bare CI database (this plugin's own migrations only create accounts.*)
  // doesn't have that schema, so probe before seeding or the suite 42P01s
  // instead of skipping cleanly.
  const schemaCheck = await pool.query<{ packages_ok: string | null; variants_ok: string | null }>(
    `SELECT to_regclass('packages.packages')::text AS packages_ok,
            to_regclass('packages.package_variants')::text AS variants_ok`,
  );
  if (!schemaCheck.rows[0]?.packages_ok || !schemaCheck.rows[0]?.variants_ok) {
    return {
      honoApp: new Hono(),
      pool,
      db: null as unknown as FakePluginDb,
      rollback: async () => {},
      ready: false,
      packageId: 0,
      variantAId: 0,
      variantBId: 0,
    };
  }

  await pool.query(
    `INSERT INTO public."user" (id, email, role, name)
     VALUES ('test-user-id', 'test@ci.local', 'superuser', 'CI User')
     ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
    [testOrg, `CI Workspace ${testOrg}`, wsSlug],
  );

  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE role = 'superuser' LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("integration test needs a real superuser in public.user");

  const rdb = await withRollbackDb(pool, ["accounts"]);
  const db = rdb.db;

  const pkgRes = await db.query<{ id: number }>(
    `INSERT INTO packages.packages (workspace_id, name, type, effective_from, lineage_slug)
     VALUES ($1, 'Cart Edit Test Package', 'daily', CURRENT_DATE, $2)
     RETURNING id`,
    [testOrg, `cart-edit-test-pkg-${testOrg}`],
  );
  const packageId = pkgRes.rows[0].id;
  const variantA = await db.query<{ id: number }>(
    `INSERT INTO packages.package_variants (package_id, name, kind, duration_value, duration_unit, price, currency)
     VALUES ($1, 'Call Booth', 'standard', 1, 'hour', 500.00, 'PHP') RETURNING id`,
    [packageId],
  );
  const variantB = await db.query<{ id: number }>(
    `INSERT INTO packages.package_variants (package_id, name, kind, duration_value, duration_unit, price, currency)
     VALUES ($1, 'Inner Area', 'standard', 1, 'hour', 300.00, 'PHP') RETURNING id`,
    [packageId],
  );

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: testOrg,
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
  const honoApp = new Hono();
  honoApp.use("*", (_c, next) =>
    runWithTenantContext({ wsId: testOrg, userId, role: "superuser", wsRole: "admin" }, () => next()),
  );
  honoApp.route("/", router);

  return {
    honoApp,
    pool,
    db,
    rollback: rdb.rollback,
    ready: true,
    packageId,
    variantAId: variantA.rows[0].id,
    variantBId: variantB.rows[0].id,
  };
}
