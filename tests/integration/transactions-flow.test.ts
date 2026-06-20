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

  // CI runs against a freshly-created database with no kernel or plugin tables.
  // Create the minimum kernel-level tables (user + workspace) plus every
  // accounts.* table the route handlers reference. Column lists match the
  // production migration (20260527000000_create_transactions.ts); CHECK
  // constraints and indexes are omitted for speed.
  await pool.query(`
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
  `);

  // Ensure the image column exists even if the table was created by an older
  // migration/seed that omitted it (CREATE TABLE IF NOT EXISTS is a no-op
  // when the table already exists without the column).
  await pool.query(`ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS image TEXT`);

  // Seed a test superuser + workspace so FK references succeed. Idempotent.
  const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
  await pool.query(
    `INSERT INTO public."user" (id, email, role, name)
     VALUES ($1, 'test-ci@hilinga.local', 'superuser', 'CI Test User')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID],
  );
  const TEST_WORKSPACE_ID = 3;
  await pool.query(
    `INSERT INTO public.workspaces (id, name)
     VALUES ($1, 'CI Test Workspace')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_WORKSPACE_ID],
  );

  // Plugin schema + tables. Separate statement because PostgreSQL does not
  // allow function expressions (e.g. lower()) in inline UNIQUE constraints
  // inside CREATE TABLE — those must be separate CREATE UNIQUE INDEX statements.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS accounts`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts.transactions (
      id                     SERIAL PRIMARY KEY,
      workspace_id           INTEGER NOT NULL,
      category               TEXT NOT NULL,
      source_account_id      INTEGER,
      destination_account_id INTEGER,
      amount                 NUMERIC(12,2) NOT NULL,
      currency               TEXT NOT NULL DEFAULT 'PHP',
      description            TEXT NOT NULL,
      notes                  TEXT,
      transaction_date       DATE NOT NULL,
      is_private             BOOLEAN NOT NULL DEFAULT FALSE,
      status                 TEXT NOT NULL DEFAULT 'completed',
      is_backdated           BOOLEAN NOT NULL DEFAULT FALSE,
      backdate_reason        TEXT,
      created_by             TEXT NOT NULL,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reference_number       TEXT,
      tax_type               TEXT NOT NULL DEFAULT 'vat_inclusive',
      tax_rate               NUMERIC(5,2) NOT NULL DEFAULT 12.00,
      tax_amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
      subtotal               NUMERIC(12,2),
      updated_by             TEXT,
      client_id              INTEGER,
      voucher_id             INTEGER,
      discount_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
      payable_kind           TEXT,
      due_date               DATE,
      cheque_number          TEXT,
      pdc_status             TEXT,
      subcategory            TEXT,
      has_ewt                BOOLEAN NOT NULL DEFAULT FALSE,
      ewt_rate               NUMERIC(5,2),
      ewt_amount             NUMERIC(12,2),
      payee_id               INTEGER,
      notion_id              TEXT,
      parent_transaction_id  INTEGER,
      batch_code             INTEGER
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_line_items (
      id                   SERIAL PRIMARY KEY,
      transaction_id       INTEGER NOT NULL,
      workspace_id         INTEGER NOT NULL,
      package_id           INTEGER,
      package_variant_id   INTEGER,
      description          TEXT NOT NULL,
      quantity             INTEGER NOT NULL DEFAULT 1,
      unit_price           NUMERIC(12,2) NOT NULL,
      duration_value       NUMERIC(10,2),
      duration_unit        TEXT,
      started_at           TIMESTAMPTZ,
      ends_at              TIMESTAMPTZ,
      status               TEXT NOT NULL DEFAULT 'completed',
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      client_id            INTEGER,
      customer_group_id    INTEGER
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_subcategories (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      applies_to  TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      is_active   BOOLEAN NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_attachments (
      id             SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL,
      file_name      TEXT NOT NULL,
      file_size      INTEGER NOT NULL,
      mime_type      TEXT NOT NULL,
      uploaded_by    TEXT NOT NULL,
      s3_link        TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_visibility (
      id             SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL,
      user_id        TEXT NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_visibility_role (
      id             SERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL,
      role_code      TEXT NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_payments (
      id                   SERIAL PRIMARY KEY,
      transaction_id       INTEGER NOT NULL,
      workspace_id         INTEGER NOT NULL,
      financial_account_id INTEGER NOT NULL,
      amount               NUMERIC(12,2) NOT NULL,
      notes                TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      customer_group_id    INTEGER
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_edits (
      id             BIGSERIAL PRIMARY KEY,
      transaction_id INTEGER NOT NULL,
      workspace_id   INTEGER NOT NULL,
      edited_by      TEXT NOT NULL,
      edited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reason         TEXT NOT NULL,
      kind           TEXT NOT NULL DEFAULT 'edit'
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_customer_groups (
      id               SERIAL PRIMARY KEY,
      transaction_id   INTEGER NOT NULL,
      workspace_id     INTEGER NOT NULL,
      "position"       INTEGER NOT NULL DEFAULT 0,
      client_id        INTEGER,
      display_name     TEXT NOT NULL,
      note             TEXT,
      voucher_id       INTEGER,
      subtotal         NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
      is_payer         BOOLEAN NOT NULL DEFAULT FALSE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts.transaction_customers (
      transaction_id INTEGER NOT NULL,
      client_id      INTEGER NOT NULL,
      workspace_id   INTEGER NOT NULL,
      "position"     INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (transaction_id, client_id)
    );
  `);

  // Unique index on subcategory (lower(name), applies_to) — PostgreSQL does
  // not allow function expressions in inline UNIQUE constraints.
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_subcat_name_applies
       ON accounts.transaction_subcategories (lower(name), applies_to)`,
  );

  // Ensure columns that were added in later migrations exist even when the
  // CREATE TABLE IF NOT EXISTS was a no-op (table pre-existing from an older
  // run without these columns).
  await pool.query(`ALTER TABLE accounts.transaction_attachments ADD COLUMN IF NOT EXISTS s3_link TEXT`);
  await pool.query(`ALTER TABLE accounts.transaction_attachments DROP COLUMN IF EXISTS file_path`);

  // Resolve the superuser created by migrations+seeds. Done on the raw pool
  // BEFORE withRollbackDb opens the outer transaction.
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
    if (res.status !== 200) require("fs").writeFileSync("/tmp/test-debug.txt", `DETAIL ${res.status} ${JSON.stringify(res.body)}\n`, { flag: "a" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(newId);
    // Mirrors the e2e guard: detail must not 500 on customer_group resolution.
    expect(Array.isArray(res.body.customer_groups)).toBe(true);
  });

  it("voids (soft-deletes) the transaction", async () => {
    const res = await request(app).delete(`/${newId}`);
    if (res.status !== 204) require("fs").writeFileSync("/tmp/test-debug.txt", `VOID ${res.status} ${JSON.stringify(res.body)}\n`, { flag: "a" });
    expect(res.status).toBe(204);
  });

  it("a voided transaction leaves the default active list", async () => {
    const res = await request(app).get(`/?search=${encodeURIComponent(desc)}`);
    expect(res.status).toBe(200);
    const found = (res.body.data as Array<{ id: number }>).find((t) => t.id === newId);
    expect(found, "voided transaction must not appear in the active list").toBeUndefined();
  });
});
