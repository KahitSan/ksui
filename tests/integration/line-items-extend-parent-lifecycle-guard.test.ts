import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildLineItemsRouter } from "../../server/routes-line-items.js";
import { withRollbackDb, stubMiddleware } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";
import { request } from "./cart-edit-fixtures.js";

// Regression test for the charge-overage/extend gap: both routes lock the
// parent via lockParentForReprice but, before this fix, never called
// assertParentEditable — so a voided/forfeited (written-off) parent could
// still be repriced. Same corruption class the apply-cart-edit/void guard
// (cart-edit-parent-lifecycle-guard.test.ts) already closes, different entry
// point (routes-line-items.ts's basePath, not routes.ts's).

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async (ids: number[]) => (ids.includes(variantRowId) ? [VARIANT] : null),
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async () => null,
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 49;
const SCHEMAS = ["accounts"];

let variantPackageId: number;
let variantRowId: number;
const VARIANT = {
  get id() {
    return variantRowId;
  },
  get package_id() {
    return variantPackageId;
  },
  name: "Lifecycle Guard Pass",
  kind: "standard",
  price: "300.00",
  currency: "PHP",
  duration_value: "1",
  duration_unit: "hour",
  is_active: true,
};

let honoApp: Hono;
let pool: pg.Pool;
let db: PluginDb;
let rollback: () => Promise<void>;
let ready = false;

beforeAll(async () => {
  pool = new pg.Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "ks_erp",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    max: 3,
  });

  // packages.packages / packages.package_variants live in another plugin's
  // schema — a bare CI database (this plugin's own migrations only create
  // accounts.*) doesn't have them, so probe before seeding or the suite
  // 42P01s instead of skipping cleanly.
  const schemaCheck = await pool.query<{ packages_ok: string | null; variants_ok: string | null }>(
    `SELECT to_regclass('packages.packages')::text AS packages_ok,
            to_regclass('packages.package_variants')::text AS variants_ok`,
  );
  if (!schemaCheck.rows[0]?.packages_ok || !schemaCheck.rows[0]?.variants_ok) {
    return;
  }

  await pool.query(
    `INSERT INTO public."user" (id, email, role, name)
     VALUES ('test-user-id', 'test@ci.local', 'superuser', 'CI User')
     ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
    [TEST_ORG, `CI Workspace ${TEST_ORG}`, "ci-ws-49"],
  );

  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE role = 'superuser' LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("integration test needs a real superuser in public.user");

  const rdb = await withRollbackDb(pool, SCHEMAS);
  db = rdb.db as unknown as PluginDb;
  rollback = rdb.rollback;

  const pkgRes = await db.query<{ id: number }>(
    `INSERT INTO packages.packages (workspace_id, name, type, effective_from, lineage_slug)
     VALUES ($1, 'Lifecycle Guard Test Package', 'daily', CURRENT_DATE, $2)
     RETURNING id`,
    [TEST_ORG, `lifecycle-guard-test-pkg-${TEST_ORG}`],
  );
  variantPackageId = pkgRes.rows[0].id;

  const variantRes = await db.query<{ id: number }>(
    `INSERT INTO packages.package_variants
       (package_id, name, kind, duration_value, duration_unit, price, currency)
     VALUES ($1, 'Lifecycle Guard Pass', 'standard', 1, 'hour', 300.00, 'PHP')
     RETURNING id`,
    [variantPackageId],
  );
  variantRowId = variantRes.rows[0].id;

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: TEST_ORG,
    userId,
    role: "superuser",
    wsRole: "admin",
    permissions: ["transactions.view", "transactions.create", "transactions.edit"],
  });
  const router = buildLineItemsRouter({ db, requireAuth, requireWorkspace, requirePermission });
  honoApp = new Hono();
  honoApp.use("*", (_c, next) =>
    runWithTenantContext({ wsId: TEST_ORG, userId, role: "superuser", wsRole: "admin" }, () => next()),
  );
  honoApp.route("/", router);
  ready = true;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

/** Seeds a transaction already outside the editable lifecycle, with one overdue active line. */
async function seedNonEditableParent(
  kind: "voided" | "forfeited",
): Promise<{ transactionId: number; lineId: number }> {
  const isVoided = kind === "voided";
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by,
        subtotal, discount_amount, forfeited_at, forfeited_amount, forfeited_by, forfeited_reason)
     VALUES ($1, 'sale', 'Sales - services', 200, $2, CURRENT_DATE, $3, $4,
             200, 0, $5, $6, $7, $8)
     RETURNING id`,
    [
      TEST_ORG,
      `line-items-extend-lifecycle-guard-${kind}-${Date.now()}-${seedCounter++}`,
      isVoided ? "voided" : "completed",
      "test-user-id",
      isVoided ? null : new Date(),
      isVoided ? null : 200,
      isVoided ? null : "test-user-id",
      isVoided ? null : "written off",
    ],
  );
  const transactionId = txnRes.rows[0].id;

  const lineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Session pass', 2, 100, 1, 'hour',
             NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 'active', NULL)
     RETURNING id`,
    [transactionId, TEST_ORG, variantPackageId, variantRowId],
  );

  return { transactionId, lineId: lineRes.rows[0].id };
}

describe("charge-overage / extend — parent lifecycle guard (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("charge-overage against a voided parent returns 409 and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedNonEditableParent("voided");

    const res = await request(honoApp, "POST", `/api/transaction-line-items/${lineId}/charge-overage`, {
      package_variant_id: variantRowId,
      quantity: 1,
    });
    expect(res.status).toBe(409);

    const lines = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_line_items WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(lines.rows[0].n).toBe("1");

    const txn = await db.query<{ subtotal: string }>(
      `SELECT subtotal FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(parseFloat(txn.rows[0].subtotal)).toBe(200);
  });

  it("extend against a forfeited parent returns 409 and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedNonEditableParent("forfeited");

    const res = await request(honoApp, "POST", `/api/transaction-line-items/${lineId}/extend`, {
      package_variant_id: variantRowId,
      quantity: 1,
    });
    expect(res.status).toBe(409);

    const lines = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_line_items WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(lines.rows[0].n).toBe("1");

    const txn = await db.query<{ subtotal: string }>(
      `SELECT subtotal FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(parseFloat(txn.rows[0].subtotal)).toBe(200);
  });
});
