import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { withRollbackDb, stubMiddleware, type FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";

// Pins the multi-customer child-charge path off a single-cg parent: POST
// /charge with parent_transaction_id + TWO customer_groups must attribute
// each group to its own client (not collapse to the parent's payer), persist
// per-group subtotals, and default each new line's started_at to "now" — NOT
// inherit it from the parent's existing line window. This is the grounding
// pass's previously-unverified started_at question, settled with a real
// assertion: the parent's own line is seeded with a started_at far in the
// past specifically so an accidental inheritance bug would show up as a
// stale timestamp instead of "now-ish".

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

// Manual line items only (no package_variant_id, no voucher_code) so the
// packages/vouchers RPC branches never fire — the test needs only Postgres.
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

const TEST_ORG = 211;
const CLIENT_A = 601;
const CLIENT_B = 602;
// Far enough in the past that "started_at defaulted from now" and "started_at
// inherited from the parent's line" can never collide by accident.
const PARENT_LINE_STARTED_AT = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let destinationAccountId: number;

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
     VALUES ($1, 'CI Workspace 211', 'ci-ws-211')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_ORG],
  );

  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE role = 'superuser' LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("integration test needs a real superuser in public.user");

  const rdb = await withRollbackDb(pool, ["accounts"]);
  db = rdb.db;
  rollback = rdb.rollback;

  const acctRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
       VALUES ($1, 'CI Counter Cash', 'cash') RETURNING id`,
    [TEST_ORG],
  );
  destinationAccountId = acctRes.rows[0].id;

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: TEST_ORG,
    userId,
    role: "superuser",
    wsRole: "admin",
    permissions: ["transactions.view", "transactions.create", "transactions.edit"],
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
});

afterAll(async () => {
  await rollback();
  await pool.end();
});

let seedCounter = 0;

/** Inserts a single-cg parent transaction with one customer group + one line item, whose started_at is far in the past. */
async function seedSingleCgParent(): Promise<{ transactionId: number; customerGroupId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, destination_account_id, amount, description, transaction_date,
        status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', $2, 500, $3, CURRENT_DATE, 'completed', $4, 500, 0)
     RETURNING id`,
    [
      TEST_ORG,
      destinationAccountId,
      `multi-cg-parent-test-${Date.now()}-${seedCounter++}`,
      "test-user-id",
    ],
  );
  const transactionId = txnRes.rows[0].id;

  const cgRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, client_id, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, $3, 'Original Payer', 500, 0, TRUE)
     RETURNING id`,
    [transactionId, TEST_ORG, CLIENT_A],
  );
  const customerGroupId = cgRes.rows[0].id;

  await db.query(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, description, quantity, unit_price, started_at, ends_at, status, client_id, customer_group_id)
     VALUES ($1, $2, 'Original session', 1, 500, $3, $3, 'completed', $4, $5)`,
    [transactionId, TEST_ORG, PARENT_LINE_STARTED_AT, CLIENT_A, customerGroupId],
  );

  return { transactionId, customerGroupId };
}

describe("POST /charge — multi-customer child of a single-cg parent (real Postgres)", () => {
  it("attributes two distinct customer_group rows to two distinct clients with correct per-group subtotals and now-ish started_at", async () => {
    const { transactionId: parentTransactionId } = await seedSingleCgParent();
    const before = Date.now();

    const res = await request(honoApp, "POST", "/charge", {
      destination_account_id: destinationAccountId,
      parent_transaction_id: parentTransactionId,
      items: [
        { description: "Booth rental — Customer A", quantity: 1, unit_price: 300 },
        { description: "Booth rental — Customer B", quantity: 1, unit_price: 200 },
      ],
      customer_groups: [
        { client_id: CLIENT_A, display_name: "Customer A", is_payer: true, item_indices: [0] },
        { client_id: CLIENT_B, display_name: "Customer B", is_payer: false, item_indices: [1] },
      ],
    });
    const after = Date.now();
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.transaction.parent_transaction_id).toBe(parentTransactionId);
    // A brand-new child transaction, not a reuse of the parent's own id.
    expect(body.transaction.id).not.toBe(parentTransactionId);

    const cgRows = await db.query<{
      client_id: number;
      display_name: string;
      subtotal: string;
      is_payer: boolean;
    }>(
      `SELECT client_id, display_name, subtotal, is_payer
         FROM accounts.transaction_customer_groups
        WHERE transaction_id = $1
        ORDER BY "position" ASC`,
      [body.transaction.id],
    );
    expect(cgRows.rows).toHaveLength(2);
    expect(cgRows.rows[0].client_id).toBe(CLIENT_A);
    expect(parseFloat(cgRows.rows[0].subtotal)).toBe(300);
    expect(cgRows.rows[0].is_payer).toBe(true);
    expect(cgRows.rows[1].client_id).toBe(CLIENT_B);
    expect(parseFloat(cgRows.rows[1].subtotal)).toBe(200);
    expect(cgRows.rows[1].is_payer).toBe(false);
    // The two groups are distinct identities, not the same client duplicated.
    expect(cgRows.rows[0].client_id).not.toBe(cgRows.rows[1].client_id);

    const lineRows = await db.query<{ started_at: Date; client_id: number; customer_group_id: number }>(
      `SELECT started_at, client_id, customer_group_id
         FROM accounts.transaction_line_items
        WHERE transaction_id = $1
        ORDER BY id ASC`,
      [body.transaction.id],
    );
    expect(lineRows.rows).toHaveLength(2);
    for (const [i, row] of lineRows.rows.entries()) {
      const startedAtMs = new Date(row.started_at).getTime();
      // Tolerance window against the DB clock rather than an exact match —
      // the request round-trip takes nonzero wall time.
      expect(startedAtMs).toBeGreaterThanOrEqual(before - 2000);
      expect(startedAtMs).toBeLessThanOrEqual(after + 2000);
      // The regression this pins: started_at must NOT come from the parent's
      // line window, which is 30 days in the past.
      expect(startedAtMs).not.toBe(PARENT_LINE_STARTED_AT.getTime());
      expect(row.client_id).toBe(i === 0 ? CLIENT_A : CLIENT_B);
    }
  });
});
