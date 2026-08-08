import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes.js";
import { todayInOrgTimezone } from "../../server/lib/backdate.js";
import { withRollbackDb, stubMiddleware, type FakePluginDb } from "@kahitsan/plugin-sdk/test";
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

// Same graceful-degradation posture as transactions-flow.test.ts — this suite
// only exercises the forfeit write path + /outstanding read against a real
// Postgres, never cross-plugin name resolution.
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

// Every run seeds its OWN workspace — no fixed id collides with real tenants
// in the shared snapshot DB, so the fixture is fully self-contained.
// eslint-disable-next-line sonarjs/pseudo-random
const RUN_ID = 1_000_000 + Math.floor(Math.random() * 800_000_000);
const TEST_ORG = RUN_ID;
const SCHEMAS = ["accounts"];

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let paymentAccountId: number;

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
  db = rdb.db;

  // The payment-leg route now asserts financial_account_id belongs to the
  // caller's workspace (assertOrgOwnsRow) — a real row is required so the
  // partial-payment test below exercises the flow instead of tripping the check.
  const acctRow = await db.query<{ id: number }>(
    `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
       VALUES ($1, 'CI Forfeit Payment Account', 'cash') RETURNING id`,
    [TEST_ORG],
  );
  paymentAccountId = acctRow.rows[0].id;

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: TEST_ORG,
    userId,
    role: "superuser",
    wsRole: "admin",
    permissions: [
      "transactions.view",
      "transactions.create",
      "transactions.edit",
      "transactions.delete",
    ],
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

// Sequential + state-sharing, same shape as transactions-flow.test.ts's
// create → void journey: create a sale, part-pay it, forfeit the remainder,
// and confirm the already-collected payment leg survives untouched.
describe("transactions forfeit: create → part-pay → forfeit → outstanding (real Postgres)", () => {
  const desc = `integ-forfeit-${Date.now()}`;
  let newId: number;

  it("creates a sale with a balance", async () => {
    const res = await request(honoApp, "POST", "/", {
      category: "sale",
      amount: "100.00",
      description: desc,
      transaction_date: todayInOrgTimezone(),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    newId = body.id;
  });

  it("shows the full amount outstanding before any payment", async () => {
    const res = await request(honoApp, "GET", "/outstanding");
    const body = await res.json();
    expect(res.status).toBe(200);
    const row = (body.data as Array<{ id: number; balance: string }>).find((r) => r.id === newId);
    expect(row, "unpaid sale must appear in /outstanding").toBeTruthy();
    expect(row?.balance).toBe("100.00");
  });

  it("records a partial payment", async () => {
    const res = await request(honoApp, "POST", `/${newId}/payments`, {
      financial_account_id: paymentAccountId,
      amount: "40.00",
    });
    expect(res.status).toBe(201);
    const res2 = await request(honoApp, "GET", "/outstanding");
    const body2 = await res2.json();
    const row = (body2.data as Array<{ id: number; balance: string }>).find((r) => r.id === newId);
    expect(row?.balance).toBe("60.00");
  });

  let activeLineId: number;

  it("has an active line item still running (the no-show session)", async () => {
    const insert = await db.query<{ id: number }>(
      `INSERT INTO accounts.transaction_line_items
         (transaction_id, workspace_id, description, quantity, unit_price, status, started_at, ends_at)
       VALUES ($1, $2, 'Test Room', 1, 100.00, 'active', NOW(), NOW() + INTERVAL '1 hour')
       RETURNING id`,
      [newId, TEST_ORG],
    );
    activeLineId = insert.rows[0].id;
    expect(activeLineId).toBeGreaterThan(0);
  });

  it("rejects a forfeit with no reason", async () => {
    const res = await request(honoApp, "POST", `/${newId}/forfeit`, { reason: "  " });
    expect(res.status).toBe(400);
  });

  it("forfeits the remaining balance, writing the amount down to what was collected", async () => {
    const res = await request(honoApp, "POST", `/${newId}/forfeit`, {
      reason: "Customer no-showed, past refund window",
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.forfeited_amount).toBe("60.00");
    // The headline amount must drop to the ₱40 actually collected — leaving
    // it at the original ₱100 would overstate revenue on the transactions
    // list even though the balance no longer shows as due.
    expect(body.amount).toBe("40.00");
  });

  it("no longer appears in /outstanding after forfeiting", async () => {
    const res = await request(honoApp, "GET", "/outstanding");
    const body = await res.json();
    const row = (body.data as Array<{ id: number }>).find((r) => r.id === newId);
    expect(row, "forfeited sale must leave /outstanding").toBeUndefined();
  });

  it("detail reflects the written-down amount and a zero balance", async () => {
    const res = await request(honoApp, "GET", `/${newId}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.amount).toBe("40.00");
    expect(body.balance).toBe("0.00");
    expect(body.payment_status).toBe("forfeited");
  });

  it("settles the still-active line item so the board moves it to Done", async () => {
    const line = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [activeLineId],
    );
    expect(line.rows[0].status).toBe("completed");
  });

  it("leaves the already-collected payment leg untouched", async () => {
    const res = await request(honoApp, "GET", `/${newId}/payments`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].amount).toBe("40.00");
  });

  it("rejects forfeiting an already-forfeited transaction", async () => {
    const res = await request(honoApp, "POST", `/${newId}/forfeit`, {
      reason: "Trying again",
    });
    expect(res.status).toBe(409);
  });
});
