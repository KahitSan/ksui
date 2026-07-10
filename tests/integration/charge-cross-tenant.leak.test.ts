import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { withRollbackDb, stubMiddleware, type FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";
import { todayInOrgTimezone } from "../../server/lib/backdate.js";

// ── F5 cross-tenant destination_account_id leak test ─────────────────────────
//
// Proves POST /charge rejects a destination_account_id that belongs to
// ANOTHER workspace, against a real Postgres. destination_account_id is a
// soft (FK-less) ref into accounts.financial_accounts — without the app-level
// ownership assert in run-charge.ts, a workspace-A caller could point a sale
// at workspace B's account, corrupting B's balance with A's money and no DB
// constraint would ever catch it.
//
// Extended to cover the SAME missing check on the manual transaction
// create/edit routes (transactions-core.ts) and the payment-leg routes
// (payments.ts) — the #5 fix only closed the charge path; run-charge.ts's
// assertOrgOwnsRow pattern is now reused at every other site that persists a
// source/destination/financial_account_id.

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

const WS_A = 3;
const WS_B = 4;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ownAccountId: number;
let otherAccountId: number;

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
    `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, 'CI Workspace A', 'ci-ws-a')
       ON CONFLICT (id) DO NOTHING`,
    [WS_A],
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, 'CI Workspace B', 'ci-ws-b')
       ON CONFLICT (id) DO NOTHING`,
    [WS_B],
  );

  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE role = 'superuser' LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("integration test needs a real superuser in public.user");

  const rdb = await withRollbackDb(pool, ["accounts"]);
  rollback = rdb.rollback;
  db = rdb.db;

  const ownRow = await db.query<{ id: number }>(
    `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
       VALUES ($1, 'CI Own Account', 'cash') RETURNING id`,
    [WS_A],
  );
  ownAccountId = ownRow.rows[0].id;
  const otherRow = await db.query<{ id: number }>(
    `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
       VALUES ($1, 'CI Other Workspace Account', 'cash') RETURNING id`,
    [WS_B],
  );
  otherAccountId = otherRow.rows[0].id;

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: WS_A,
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
    runWithTenantContext({ wsId: WS_A, userId, role: "superuser", wsRole: "admin" }, () => next()),
  );
  honoApp.route("/", router);
});

afterAll(async () => {
  await rollback();
  await pool.end();
});

describe("POST /charge — cross-workspace destination_account_id (real Postgres)", () => {
  it("rejects a destination_account_id belonging to a different workspace (404, not 500)", async () => {
    const res = await request(honoApp, "POST", "/charge", {
      destination_account_id: otherAccountId,
      items: [{ description: "CI cross-tenant probe", quantity: 1, unit_price: 100 }],
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/destination_account_id/);

    // The row must never have landed — the check runs BEFORE the INSERT.
    const leaked = await pool.query(
      `SELECT 1 FROM accounts.transactions WHERE destination_account_id = $1 AND workspace_id = $2`,
      [otherAccountId, WS_A],
    );
    expect(leaked.rows).toHaveLength(0);
  });

  it("accepts a destination_account_id belonging to the caller's own workspace", async () => {
    const res = await request(honoApp, "POST", "/charge", {
      destination_account_id: ownAccountId,
      items: [{ description: "CI own-account charge", quantity: 1, unit_price: 100 }],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.transaction.destination_account_id).toBe(ownAccountId);
  });
});

const todayIso = todayInOrgTimezone();

describe("POST / (manual create) — cross-workspace source/destination_account_id", () => {
  it("rejects a source_account_id belonging to a different workspace (404, not 500)", async () => {
    const res = await request(honoApp, "POST", "/", {
      category: "expense",
      description: "CI manual-create source probe",
      amount: 50,
      transaction_date: todayIso,
      source_account_id: otherAccountId,
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/source_account_id/);

    // Read via `db` (the rollback-wrapped connection the request itself
    // wrote through) — the raw `pool` is a separate connection and would
    // never see the uncommitted row either way, making the check a no-op.
    const leaked = await db.query(
      `SELECT 1 FROM accounts.transactions WHERE source_account_id = $1 AND workspace_id = $2`,
      [otherAccountId, WS_A],
    );
    expect(leaked.rows).toHaveLength(0);
  });

  it("rejects a destination_account_id belonging to a different workspace (404, not 500)", async () => {
    const res = await request(honoApp, "POST", "/", {
      category: "sale",
      description: "CI manual-create destination probe",
      amount: 50,
      transaction_date: todayIso,
      destination_account_id: otherAccountId,
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/destination_account_id/);
  });

  it("accepts a source_account_id belonging to the caller's own workspace", async () => {
    const res = await request(honoApp, "POST", "/", {
      category: "expense",
      description: "CI manual-create own-account",
      amount: 50,
      transaction_date: todayIso,
      source_account_id: ownAccountId,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source_account_id).toBe(ownAccountId);
  });
});

describe("PUT /:id (edit) — cross-workspace source_account_id", () => {
  let ownTxnId: number;

  beforeAll(async () => {
    const row = await db.query<{ id: number }>(
      `INSERT INTO accounts.transactions
         (workspace_id, category, source_account_id, amount, description, transaction_date, created_by)
       VALUES ($1, 'expense', $2, 10, 'CI edit-target', $3, $4)
       RETURNING id`,
      [WS_A, ownAccountId, todayIso, "test-user-id"],
    );
    ownTxnId = row.rows[0].id;
  });

  it("rejects reassigning source_account_id to a different workspace's account (404, not 500)", async () => {
    const res = await request(honoApp, "PUT", `/${ownTxnId}`, {
      source_account_id: otherAccountId,
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/source_account_id/);

    // The row must be untouched — the check runs BEFORE the UPDATE. Read via
    // `db` (the withRollbackDb savepoint connection the request itself wrote
    // through), not the raw `pool` — the write is uncommitted and invisible
    // to any other connection until the whole test file's transaction ends.
    const row = await db.query<{ source_account_id: number }>(
      `SELECT source_account_id FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
      [ownTxnId, WS_A],
    );
    expect(row.rows[0].source_account_id).toBe(ownAccountId);
  });
});

describe("Payment legs — cross-workspace financial_account_id + amount ceiling", () => {
  let ownTxnId: number;
  let ownPaymentId: number;

  beforeAll(async () => {
    const row = await db.query<{ id: number }>(
      `INSERT INTO accounts.transactions
         (workspace_id, category, amount, description, transaction_date, created_by)
       VALUES ($1, 'sale', 500, 'CI payment-target', $2, $3)
       RETURNING id`,
      [WS_A, todayIso, "test-user-id"],
    );
    ownTxnId = row.rows[0].id;
  });

  it("POST /:id/payments rejects a financial_account_id belonging to a different workspace (404, not 500)", async () => {
    const res = await request(honoApp, "POST", `/${ownTxnId}/payments`, {
      financial_account_id: otherAccountId,
      amount: 100,
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/financial_account_id/);

    const leaked = await db.query(
      `SELECT 1 FROM accounts.transaction_payments WHERE financial_account_id = $1 AND transaction_id = $2`,
      [otherAccountId, ownTxnId],
    );
    expect(leaked.rows).toHaveLength(0);
  });

  it("POST /:id/payments rejects an amount at/above the NUMERIC(12,2) ceiling (400, not 500)", async () => {
    const res = await request(honoApp, "POST", `/${ownTxnId}/payments`, {
      financial_account_id: ownAccountId,
      amount: 1e10,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/exceed/);
  });

  it("POST /:id/payments accepts a financial_account_id belonging to the caller's own workspace", async () => {
    const res = await request(honoApp, "POST", `/${ownTxnId}/payments`, {
      financial_account_id: ownAccountId,
      amount: 100,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    ownPaymentId = body.id;
    expect(body.financial_account_id).toBe(ownAccountId);
  });

  it("PUT /:id/payments/:paymentId rejects reassigning financial_account_id to a different workspace's account (404, not 500)", async () => {
    const res = await request(honoApp, "PUT", `/${ownTxnId}/payments/${ownPaymentId}`, {
      financial_account_id: otherAccountId,
      amount: 100,
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/financial_account_id/);

    const row = await db.query<{ financial_account_id: number }>(
      `SELECT financial_account_id FROM accounts.transaction_payments WHERE id = $1`,
      [ownPaymentId],
    );
    expect(row.rows[0].financial_account_id).toBe(ownAccountId);
  });

  it("PUT /:id/payments/:paymentId rejects an amount at/above the NUMERIC(12,2) ceiling (400, not 500)", async () => {
    const res = await request(honoApp, "PUT", `/${ownTxnId}/payments/${ownPaymentId}`, {
      financial_account_id: ownAccountId,
      amount: 1e10,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/exceed/);
  });
});
