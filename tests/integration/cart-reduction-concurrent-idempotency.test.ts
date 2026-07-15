import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";
import { stubMiddleware } from "@kahitsan/plugin-sdk/test";
import { buildRouter } from "../../server/routes.js";
import { request } from "./cart-edit-fixtures.js";

// Regression test for the pre-lock replay race: two concurrent apply-cart-edit
// calls with the same edit_token must serialize on the parent FOR UPDATE lock
// so only ONE actually voids/reprices — the loser replays the winner's stored
// payload instead of erroring or double-mutating.
//
// This needs TWO real, independently-blocking Postgres connections, so unlike
// the rest of the cart-edit suite it can't use the single-client
// withRollbackDb savepoint fixture (every "connection" there is the same
// session, which can't self-block on its own FOR UPDATE lock). Seeds go
// straight onto the live worktree DB under a dedicated workspace id and are
// deleted explicitly in afterAll — see CLAUDE.md's migration-testing note on
// treating worktree DBs as real.

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

const TEST_ORG = 148;

let pool: pg.Pool;
let honoApp: Hono;
let ready = false;
let packageId: number;
let variantId: number;

beforeAll(async () => {
  pool = new pg.Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "ks_erp",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    max: 5,
  });

  const schemaCheck = await pool.query<{ packages_ok: string | null; variants_ok: string | null }>(
    `SELECT to_regclass('packages.packages')::text AS packages_ok,
            to_regclass('packages.package_variants')::text AS variants_ok`,
  );
  if (!schemaCheck.rows[0]?.packages_ok || !schemaCheck.rows[0]?.variants_ok) {
    ready = false;
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
    [TEST_ORG, `CI Workspace ${TEST_ORG}`, "ci-ws-148"],
  );

  const pkgRes = await pool.query<{ id: number }>(
    `INSERT INTO packages.packages (workspace_id, name, type, effective_from, lineage_slug)
     VALUES ($1, 'Concurrent Cart Edit Test Package', 'daily', CURRENT_DATE, $2)
     RETURNING id`,
    [TEST_ORG, `cart-edit-concurrent-test-pkg-${TEST_ORG}`],
  );
  packageId = pkgRes.rows[0].id;
  const variantRes = await pool.query<{ id: number }>(
    `INSERT INTO packages.package_variants (package_id, name, kind, duration_value, duration_unit, price, currency)
     VALUES ($1, 'Concurrent Booth', 'standard', 1, 'hour', 500.00, 'PHP') RETURNING id`,
    [packageId],
  );
  variantId = variantRes.rows[0].id;

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: TEST_ORG,
    userId: "test-user-id",
    role: "superuser",
    wsRole: "admin",
    permissions: ["transactions.view", "transactions.create", "transactions.edit", "transactions.delete"],
  });
  const router = buildRouter({
    db: pool as unknown as PluginDb,
    requireAuth,
    requireWorkspace,
    requirePermission,
  });
  honoApp = new Hono();
  honoApp.use("*", (_c, next) =>
    runWithTenantContext({ wsId: TEST_ORG, userId: "test-user-id", role: "superuser", wsRole: "admin" }, () => next()),
  );
  honoApp.route("/", router);

  ready = true;
});

afterAll(async () => {
  if (ready) {
    await pool.query(
      `DELETE FROM accounts.transaction_edits WHERE workspace_id = $1`,
      [TEST_ORG],
    );
    await pool.query(
      `DELETE FROM accounts.transaction_line_items WHERE workspace_id = $1`,
      [TEST_ORG],
    );
    await pool.query(`DELETE FROM accounts.transactions WHERE workspace_id = $1`, [TEST_ORG]);
    await pool.query(`DELETE FROM packages.package_variants WHERE package_id = $1`, [packageId]);
    await pool.query(`DELETE FROM packages.packages WHERE workspace_id = $1`, [TEST_ORG]);
  }
  await pool.end();
});

async function seedTripleQtySale(): Promise<{ transactionId: number; lineId: number }> {
  const txnRes = await pool.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 1500, $2, CURRENT_DATE, 'completed', $3, 1500, 0)
     RETURNING id`,
    [TEST_ORG, `cart-reduction-concurrent-${Date.now()}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const lineRes = await pool.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Session pass', 3, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', NULL)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantId],
  );

  return { transactionId, lineId: lineRes.rows[0].id };
}

describe("POST /:id/apply-cart-edit — concurrent same-token requests (real Postgres, two connections)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("serializes on the parent lock: one mutation total, both callers see the same successful response", async () => {
    if (!ready) return;
    const { transactionId, lineId } = await seedTripleQtySale();
    const editToken = crypto.randomUUID();
    const body = {
      edit_token: editToken,
      reason: "Concurrent reduce to one session",
      reductions: [
        { customer_group_id: null, package_id: packageId, package_variant_id: variantId, target_quantity: 1 },
      ],
    };

    const [a, b] = await Promise.all([
      request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, body),
      request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, body),
    ]);
    const [aBody, bBody] = await Promise.all([a.json(), b.json()]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(aBody).toEqual(bBody);

    const line = await pool.query<{ quantity: string }>(
      `SELECT quantity FROM accounts.transaction_line_items WHERE id = $1`,
      [lineId],
    );
    expect(parseFloat(line.rows[0].quantity)).toBe(1);

    const txn = await pool.query<{ amount: string }>(
      `SELECT amount FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(parseFloat(txn.rows[0].amount)).toBe(500);

    const edits = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1 AND kind = 'cart_reduction'`,
      [transactionId],
    );
    expect(edits.rows[0].n).toBe("1");
  });
});
