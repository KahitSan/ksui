import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter } from "../../server/routes-accounts.js";
import { withRollbackDb, stubMiddleware } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";

// One vi.mock per module — vitest keys mocks by specifier, so the cross-plugin
// RPC override (fetchBalances degrades to null when transactions isn't loaded)
// and the S3 helper overrides (logo upload/download not exercised here) must
// share a single @kahitsan/plugin-sdk factory.
vi.mock("@kahitsan/plugin-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kahitsan/plugin-sdk")>();
  return {
    ...actual,
    tryCallPlugin: vi.fn().mockResolvedValue(null),
    s3Enabled: vi.fn().mockReturnValue(false),
    s3PutObject: vi.fn().mockResolvedValue(undefined),
    s3DeleteObject: vi.fn().mockResolvedValue(undefined),
    s3PublicUrl: vi
      .fn()
      .mockReturnValue("https://mock-s3.example.com/test.webp"),
    s3KeyFromUrl: vi.fn().mockReturnValue(null),
  };
});

// Financial-accounts lives in the `accounts` schema (manifest.schemas = ["accounts"]).
// withRollbackDb sets search_path = "accounts", public so unqualified table
// names resolve to accounts.financial_accounts.
//
// Flow-imitation: list → create → detail → edit → archive → verify archived
// leaves active list → restore → verify restored appears. All inside one
// rolled-back transaction. No peer RPC — mocked to null above.

const TEST_ORG = 3;

const ALL_PERMISSIONS = [
  "financial_accounts.view",
  "financial_accounts.create",
  "financial_accounts.edit",
  "financial_accounts.delete",
];

const TENANT_CTX = {
  wsId: TEST_ORG,
  userId: "integ-test-user",
  role: "superuser",
  wsRole: "admin",
};

let app: Hono;
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

  // Seed kernel-level rows (user + workspace) so FK references succeed.
  // Migrations create the tables; tests seed the rows. Idempotent.
  // Idempotent against BOTH the id and the email unique key — a prior run (or a
  // sibling plugin suite sharing this DB) may already own 'test@ci.local' under
  // a different id, which a bare ON CONFLICT (id) would not absorb.
  await pool.query(
    `INSERT INTO public."user" (id, email, role, name)
     VALUES ('test-user-id', 'test@ci.local', 'superuser', 'CI User')
     ON CONFLICT DO NOTHING`
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug)
     VALUES (3, 'CI Workspace', 'ci-workspace')
     ON CONFLICT (id) DO NOTHING`
  );

  const rdb = await withRollbackDb(pool, ["accounts"]);
  rollback = rdb.rollback;
  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: TEST_ORG,
    userId: TENANT_CTX.userId,
    role: "superuser",
    wsRole: "admin",
    permissions: ALL_PERMISSIONS,
  });
  const router = buildRouter({
    db: rdb.db as unknown as PluginDb,
    requireAuth,
    requireWorkspace,
    requirePermission,
  });
  app = new Hono();
  app.use("*", (_c, next) => runWithTenantContext(TENANT_CTX, () => next()));
  app.route("/", router);
});

afterAll(async () => {
  await rollback();
  await pool.end();
});

describe("financial-accounts flow: list → create → detail → edit → archive → restore", () => {
  const accountName = `integ-fa-${Date.now()}`;
  const editedName = `${accountName}-edited`;
  const fallbackName = `${accountName}-fallback`;
  let newId: number;
  let fallbackId: number;

  it("lists existing financial accounts for the active org", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () => app.request("/"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  it("creates a new bank account", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: accountName,
          type: "bank",
          description: "integration test account",
          icon: "landmark",
          color: "#0066cc",
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.id).toBe("number");
    expect(body.name).toBe(accountName);
    expect(body.type).toBe("bank");
    expect(body.is_active).toBe(true);
    expect(body.icon).toBe("landmark");
    expect(body.color).toBe("#0066cc");
    expect(body.workspace_id).toBe(TEST_ORG);
    newId = body.id;
  });

  it("the new account appears in the org-scoped list", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/?search=${encodeURIComponent(accountName)}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = (body.data as Array<{ id: number; name: string }>).find(
      (a) => a.name === accountName
    );
    expect(found, "created account must show in the list").toBeTruthy();
    expect(found?.id).toBe(newId);
  });

  it("opens detail with 200", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/${newId}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(newId);
    expect(body.name).toBe(accountName);
    expect(body.type).toBe("bank");
  });

  it("returns 404 for a non-existent account", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request("/999999")
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 (not 500) for a non-numeric id on the balance-enriched detail", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request("/abc")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid id");
  });

  it("edits the account name", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/${newId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editedName }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe(editedName);
  });

  it("edits the account type", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/${newId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "e_wallet" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("e_wallet");
  });

  it("sets the payment default and sort order", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/${newId}/payment-settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_default_payment: true, sort_order: 1 }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_default_payment).toBe(true);
    expect(body.sort_order).toBe(1);
  });

  it("rejects invalid payment settings without changing the account", async () => {
    const bad = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/${newId}/payment-settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_default_payment: true, sort_order: -1 }),
      })
    );
    expect(bad.status).toBe(400);

    const detail = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/${newId}`)
    );
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.is_default_payment).toBe(true);
    expect(body.sort_order).toBe(1);
  });

  it("returns 404 for payment settings on a missing account", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request("/999999/payment-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_default_payment: true, sort_order: 1 }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("moves the payment default to another account and clears the previous default", async () => {
    const createFallback = await runWithTenantContext(TENANT_CTX, () =>
      app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: fallbackName,
          type: "cash",
          sort_order: 0,
        }),
      })
    );
    expect(createFallback.status).toBe(201);
    const created = await createFallback.json();
    fallbackId = created.id;

    const moveDefault = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/${fallbackId}/payment-settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_default_payment: true, sort_order: 0 }),
      })
    );
    expect(moveDefault.status).toBe(200);

    const previous = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/${newId}`)
    );
    const previousBody = await previous.json();
    expect(previousBody.is_default_payment).toBe(false);

    const current = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/${fallbackId}`)
    );
    const currentBody = await current.json();
    expect(currentBody.is_default_payment).toBe(true);
  });

  it("orders default payment account first in the active list", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request("/?status=active&limit=200")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const first = (body.data as Array<{ id: number }>)[0];
    expect(first?.id).toBe(fallbackId);
  });

  it("archives (soft-deletes) the account", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/${newId}`, { method: "DELETE" })
    );
    expect(res.status).toBe(204);
  });

  it("archived account leaves the default active list", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/?search=${encodeURIComponent(editedName)}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = (body.data as Array<{ id: number }>).find(
      (a) => a.id === newId
    );
    expect(
      found,
      "archived account must not appear in active list"
    ).toBeUndefined();
  });

  it("archived account appears under archived filter", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/?status=archived&search=${encodeURIComponent(editedName)}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = (body.data as Array<{ id: number }>).find(
      (a) => a.id === newId
    );
    expect(found, "archived account must appear in archived list").toBeTruthy();
  });

  it("restores the archived account", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/${newId}/restore`, { method: "PATCH" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_active).toBe(true);
  });

  it("restored account reappears in the active list", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request(`/?search=${encodeURIComponent(editedName)}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = (body.data as Array<{ id: number }>).find(
      (a) => a.id === newId
    );
    expect(found, "restored account must appear in active list").toBeTruthy();
  });

  it("rejects duplicate name (case-insensitive) with 409", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: editedName, // same name, already exists
          type: "cash",
        }),
      })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });

  it("rejects invalid type with 400", async () => {
    const res = await runWithTenantContext(TENANT_CTX, () =>
      app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Bad Type Account",
          type: "invalid_type",
        }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/type must be one of/i);
  });
});
