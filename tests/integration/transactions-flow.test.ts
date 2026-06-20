import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import pg from "pg";
import type { PluginDb } from "@ks-erp/kernel/services/database";
import { buildRouter } from "../../server/routes.js";
import { todayInOrgTimezone } from "../../server/lib/backdate.js";
import { withRollbackDb, stubMiddleware } from "@kahitsan/plugin-server-utils/test";

// Peer hydration (package / variant / client / account / payee / voucher names
// resolved over the kernel RPC) is OUT OF SCOPE for this test — this suite is
// about the tenant-scoped CRUD flow against a real Postgres, not cross-plugin
// name resolution. Mock every peer resolver to its "plugin unavailable"
// degraded return (null), the SAME posture production takes when a peer plugin
// isn't loaded (see lib/peers.ts graceful-degradation contract). This keeps
// the test self-contained — it needs only Postgres, never a running kernel.
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

// Workspace 3 carries the richest real data in the prod snapshot (7877
// transactions, 7778 active) so the list/detail assertions are meaningful
// rather than vacuous. Every handler step exercises the route's explicit
// `WHERE workspace_id = $N` gate — the ONLY tenant gate that holds for a
// process-isolated plugin (RLS is dormant here).
const TEST_ORG = 3;
const SCHEMAS = ["accounts"];

let app: express.Express;
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

  // CI runs against a freshly-created database with no kernel tables. Create
  // the minimum kernel-level tables the test depends on (user + workspace) so
  // the superuser lookup and FK references succeed.
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS accounts;

    CREATE TABLE IF NOT EXISTS public."user" (
      id         TEXT PRIMARY KEY,
      email      TEXT,
      role       TEXT,
      name       TEXT,
      image      TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.workspaces (
      id   INTEGER PRIMARY KEY,
      name TEXT
    );

    -- Plugin tables: every accounts.* table the route handlers reference.
    -- Column lists derived verbatim from the INSERT/SELECT/UPDATE SQL in
    -- transactions-core.ts, transactions-detail.ts, transactions-status.ts,
    -- transactions-counter-patch.ts, payments.ts, attachments.ts, and
    -- subcategories.ts.

    CREATE TABLE IF NOT EXISTS accounts.transactions (
      id                     SERIAL PRIMARY KEY,
      workspace_id           INTEGER NOT NULL,
      category               TEXT NOT NULL,
      subcategory            TEXT,
      status                 TEXT NOT NULL DEFAULT 'completed',
      source_account_id      INTEGER,
      destination_account_id INTEGER,
      amount                 NUMERIC(12,2) NOT NULL DEFAULT 0,
      description            TEXT NOT NULL DEFAULT '',
      notes                  TEXT,
      transaction_date       DATE NOT NULL,
      is_private             BOOLEAN NOT NULL DEFAULT FALSE,
      is_backdated           BOOLEAN NOT NULL DEFAULT FALSE,
      backdate_reason        TEXT,
      created_by             TEXT,
      updated_by             TEXT,
      reference_number       TEXT,
      tax_type               TEXT NOT NULL DEFAULT 'vat_inclusive',
      tax_rate               NUMERIC(5,2) NOT NULL DEFAULT 0,
      tax_amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
      subtotal               NUMERIC(12,2) NOT NULL DEFAULT 0,
      payable_kind           TEXT,
      due_date               DATE,
      cheque_number          TEXT,
      pdc_status             TEXT,
      has_ewt                BOOLEAN NOT NULL DEFAULT FALSE,
      ewt_rate               NUMERIC(5,2),
      ewt_amount             NUMERIC(12,2),
      client_id              INTEGER,
      payee_id               INTEGER,
      created_at             TIMESTAMPTZ DEFAULT NOW(),
      updated_at             TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_payments (
      id                   SERIAL PRIMARY KEY,
      transaction_id       INTEGER NOT NULL,
      workspace_id         INTEGER NOT NULL,
      financial_account_id INTEGER,
      amount               NUMERIC(12,2) NOT NULL DEFAULT 0,
      notes                TEXT,
      customer_group_id    INTEGER,
      created_at           TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_edits (
      id             SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL,
      workspace_id   INTEGER NOT NULL,
      edited_at      TIMESTAMPTZ DEFAULT NOW(),
      edited_by      TEXT NOT NULL DEFAULT '',
      reason         TEXT NOT NULL DEFAULT '',
      kind           TEXT NOT NULL DEFAULT 'edit'
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_attachments (
      id             SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL,
      file_name      TEXT NOT NULL,
      file_size      INTEGER,
      mime_type      TEXT,
      uploaded_by    TEXT,
      s3_link        TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_line_items (
      id                   SERIAL PRIMARY KEY,
      transaction_id       INTEGER NOT NULL,
      workspace_id         INTEGER NOT NULL,
      package_id           INTEGER,
      package_variant_id   INTEGER,
      description          TEXT,
      quantity             NUMERIC,
      unit_price           NUMERIC(12,2),
      duration_value       INTEGER,
      duration_unit        TEXT,
      started_at           TIMESTAMPTZ,
      ends_at              TIMESTAMPTZ,
      status               TEXT NOT NULL DEFAULT 'active',
      client_id            INTEGER,
      customer_group_id    INTEGER,
      updated_at           TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_customer_groups (
      id               SERIAL PRIMARY KEY,
      transaction_id   INTEGER NOT NULL,
      workspace_id     INTEGER NOT NULL,
      position         INTEGER NOT NULL DEFAULT 0,
      client_id        INTEGER,
      display_name     TEXT,
      note             TEXT,
      voucher_id       INTEGER,
      subtotal         NUMERIC(12,2),
      discount_amount  NUMERIC(12,2),
      is_payer         BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_customers (
      id             SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL,
      client_id      INTEGER NOT NULL,
      workspace_id   INTEGER NOT NULL,
      position       INTEGER NOT NULL DEFAULT 0,
      UNIQUE (transaction_id, client_id)
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_visibility (
      id             SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL,
      user_id        TEXT NOT NULL,
      UNIQUE (transaction_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_visibility_role (
      id             SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL,
      role_code      TEXT NOT NULL,
      UNIQUE (transaction_id, role_code)
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_subcategories (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      applies_to  TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_active   BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS transaction_subcategories_name_applies_to_uniq
      ON accounts.transaction_subcategories (lower(name), applies_to);
  `);

  // Seed a test superuser if the table is empty (CI), or reuse an existing one
  // (local dev with prod snapshot). Use an upsert to avoid duplicates on
  // repeated runs inside the same CI container.
  const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
  await pool.query(
    `INSERT INTO public."user" (id, email, role, name)
     VALUES ($1, 'test-ci@hilinga.local', 'superuser', 'CI Test User')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID],
  );

  // Seed the test workspace so FK references to workspaces succeed.
  const TEST_WORKSPACE_ID = 3;
  await pool.query(
    `INSERT INTO public.workspaces (id, name)
     VALUES ($1, 'CI Test Workspace')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_WORKSPACE_ID],
  );

  // created_by has an FK into public.user, so the test identity must reference a
  // REAL user row. Resolve the superuser (snapshot-independent: we key off the
  // role, not a hardcoded id). Done on the raw pool BEFORE withRollbackDb
  // opens the outer transaction.
  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE role = 'superuser' LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("integration test needs a real superuser in public.user");

  const rdb = await withRollbackDb(pool, SCHEMAS);
  rollback = rdb.rollback;
  const { requireAuth, requireOrg, requirePermission } = stubMiddleware({
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
    requireOrg,
    requirePermission,
  });
  app = express();
  app.use(express.json());
  app.use(router);
});

afterAll(async () => {
  await rollback(); // discard every row the suite wrote
  await pool.end();
});

// The steps below are intentionally SEQUENTIAL and share state (newId) — they
// imitate the e2e journey they replace (record → view → void) at the API
// layer, in order, against the same rolled-back transaction.
describe("transactions flow: list → create → list → detail → void (real Postgres)", () => {
  const desc = `integ-flow-${Date.now()}`;
  let newId: number;

  it("lists existing transactions for the active org", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    // CI starts with an empty database; local dev may have prod data.
    expect(typeof res.body.total).toBe("number");
  });

  it("creates a manual expense scoped to the active org", async () => {
    const res = await request(app).post("/").send({
      category: "expense",
      amount: "99.99",
      description: desc,
      transaction_date: todayInOrgTimezone(), // PHT today ⇒ no backdate gate
    });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe("number");
    newId = res.body.id;
  });

  it("the new transaction appears in the org-scoped list", async () => {
    const res = await request(app).get(`/?search=${encodeURIComponent(desc)}`);
    expect(res.status).toBe(200);
    const found = (res.body.data as Array<{ id: number; description: string }>).find(
      (t) => t.description === desc,
    );
    expect(found, "created transaction must show in the list").toBeTruthy();
    expect(found?.id).toBe(newId);
  });

  it("opens detail with 200 + customer_groups (the regression contract)", async () => {
    const res = await request(app).get(`/${newId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(newId);
    // Mirrors the e2e guard: detail must not 500 on customer_group resolution.
    expect(Array.isArray(res.body.customer_groups)).toBe(true);
  });

  it("voids (soft-deletes) the transaction", async () => {
    const res = await request(app).delete(`/${newId}`);
    expect(res.status).toBe(204);
  });

  it("a voided transaction leaves the default active list", async () => {
    const res = await request(app).get(`/?search=${encodeURIComponent(desc)}`);
    expect(res.status).toBe(200);
    const found = (res.body.data as Array<{ id: number }>).find((t) => t.id === newId);
    expect(found, "voided transaction must not appear in the active list").toBeUndefined();
  });
});
