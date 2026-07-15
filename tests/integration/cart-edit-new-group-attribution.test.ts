import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { withRollbackDb, stubMiddleware, type FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";
import { request } from "./cart-edit-fixtures.js";

// SAME-TX-EDIT-BRIEF.md test 5: added line items carry the NEW group's
// customer_group_id and client_id, not the original payer group's, and a
// voucher on the new group discounts only that group's item subtotal.
//
// client_id and voucher_id on transaction_customer_groups/transactions carry
// REAL FKs into clients.clients / packages.vouchers in this shared legacy
// schema (same "soft cross-plugin ref at the app layer" caveat as
// extend-voucher.test.ts's VOUCHER row) — this file seeds real rows for both
// rather than using cart-edit-fixtures.ts's lighter packages-only setup.

let voucherRowId: number;
const VOUCHER = {
  get id() {
    return voucherRowId;
  },
  code: "NEWGROUP20",
  type: "percentage" as const,
  value: "20",
  max_discount_amount: null,
  minimum_purchase: null,
};

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async () => null,
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async (id: number) => (id === voucherRowId ? VOUCHER : null),
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 304;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;
let payerClientId: number;
let newClientId: number;

beforeAll(async () => {
  pool = new pg.Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "ks_erp",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    max: 3,
  });

  const schemaCheck = await pool.query<{
    packages_ok: string | null;
    variants_ok: string | null;
    vouchers_ok: string | null;
    clients_ok: string | null;
  }>(
    `SELECT to_regclass('packages.packages')::text AS packages_ok,
            to_regclass('packages.package_variants')::text AS variants_ok,
            to_regclass('packages.vouchers')::text AS vouchers_ok,
            to_regclass('clients.clients')::text AS clients_ok`,
  );
  if (
    !schemaCheck.rows[0]?.packages_ok ||
    !schemaCheck.rows[0]?.variants_ok ||
    !schemaCheck.rows[0]?.vouchers_ok ||
    !schemaCheck.rows[0]?.clients_ok
  ) {
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
    [TEST_ORG, `CI Workspace ${TEST_ORG}`, "ci-ws-304"],
  );

  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE role = 'superuser' LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("integration test needs a real superuser in public.user");

  const rdb = await withRollbackDb(pool, ["accounts"]);
  db = rdb.db;
  rollback = rdb.rollback;

  const pkgRes = await db.query<{ id: number }>(
    `INSERT INTO packages.packages (workspace_id, name, type, effective_from, lineage_slug)
     VALUES ($1, 'Cart Edit Attribution Test Package', 'daily', CURRENT_DATE, $2)
     RETURNING id`,
    [TEST_ORG, `cart-edit-attribution-pkg-${TEST_ORG}`],
  );
  packageId = pkgRes.rows[0].id;
  const variantA = await db.query<{ id: number }>(
    `INSERT INTO packages.package_variants (package_id, name, kind, duration_value, duration_unit, price, currency)
     VALUES ($1, 'Call Booth', 'standard', 1, 'hour', 500.00, 'PHP') RETURNING id`,
    [packageId],
  );
  variantAId = variantA.rows[0].id;

  const voucherRes = await db.query<{ id: number }>(
    `INSERT INTO packages.vouchers (workspace_id, code, type, value)
     VALUES ($1, 'NEWGROUP20', 'percentage', 20)
     RETURNING id`,
    [TEST_ORG],
  );
  voucherRowId = voucherRes.rows[0].id;

  const clientA = await db.query<{ id: number }>(
    `INSERT INTO clients.clients (workspace_id, name_raw) VALUES ($1, 'Payer Client') RETURNING id`,
    [TEST_ORG],
  );
  payerClientId = clientA.rows[0].id;
  const clientB = await db.query<{ id: number }>(
    `INSERT INTO clients.clients (workspace_id, name_raw) VALUES ($1, 'New Guest Client') RETURNING id`,
    [TEST_ORG],
  );
  newClientId = clientB.rows[0].id;

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: TEST_ORG,
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

async function seedPayerSale(): Promise<{ transactionId: number; payerGroupId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount, client_id)
     VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE, 'completed', $3, 500, 0, $4)
     RETURNING id`,
    [TEST_ORG, `cart-edit-attribution-${Date.now()}-${seedCounter++}`, "test-user-id", payerClientId],
  );
  const transactionId = txnRes.rows[0].id;

  const cg = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, client_id, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, $3, 'Payer', 500, 0, TRUE) RETURNING id`,
    [transactionId, TEST_ORG, payerClientId],
  );

  await db.query(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id, client_id)
     VALUES ($1, $2, $3, $4, 'Payer booking', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', $5, $6)`,
    [transactionId, TEST_ORG, packageId, variantAId, cg.rows[0].id, payerClientId],
  );

  return { transactionId, payerGroupId: cg.rows[0].id };
}

describe("POST /:id/apply-cart-edit — new-group attribution + per-group voucher (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("attributes new lines to the new group/client and discounts only that group's subtotal", async () => {
    if (!ready) return;
    const { transactionId, payerGroupId } = await seedPayerSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "New guest joins with a voucher",
      additions: [
        {
          customer_group_id: null,
          new_group: {
            client_id: newClientId,
            display_name: "New Guest",
            note: null,
            voucher_id: voucherRowId,
            is_payer: false,
            started_at: null,
          },
          items: [
            {
              package_id: packageId,
              package_variant_id: variantAId,
              description: "New guest booking",
              quantity: 1,
              unit_price: 1000,
              duration_value: 1,
              duration_unit: "hour",
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const newGroupId = body.new_customer_group_ids[0];
    const newLineId = body.added_line_item_ids[0];

    const newLine = await db.query<{ customer_group_id: number; client_id: number }>(
      `SELECT customer_group_id, client_id FROM accounts.transaction_line_items WHERE id = $1`,
      [newLineId],
    );
    expect(newLine.rows[0].customer_group_id).toBe(newGroupId);
    expect(newLine.rows[0].client_id).toBe(newClientId);
    expect(newLine.rows[0].customer_group_id).not.toBe(payerGroupId);
    expect(newLine.rows[0].client_id).not.toBe(payerClientId);

    // 20% off 1000 = 200 discount, applied ONLY to the new group.
    const newGroupRow = await db.query<{ subtotal: string; discount_amount: string; voucher_id: number }>(
      `SELECT subtotal, discount_amount, voucher_id FROM accounts.transaction_customer_groups WHERE id = $1`,
      [newGroupId],
    );
    expect(parseFloat(newGroupRow.rows[0].subtotal)).toBe(1000);
    expect(parseFloat(newGroupRow.rows[0].discount_amount)).toBe(200);
    expect(newGroupRow.rows[0].voucher_id).toBe(voucherRowId);

    const payerGroupRow = await db.query<{ subtotal: string; discount_amount: string }>(
      `SELECT subtotal, discount_amount FROM accounts.transaction_customer_groups WHERE id = $1`,
      [payerGroupId],
    );
    expect(parseFloat(payerGroupRow.rows[0].subtotal)).toBe(500);
    expect(parseFloat(payerGroupRow.rows[0].discount_amount)).toBe(0);

    // Parent totals: subtotal += 1000, discount += 200.
    expect(body.transaction.subtotal).toBe(1500);
    expect(body.transaction.discount_amount).toBe(200);
    expect(body.transaction.amount).toBe(1300);
  });
});
