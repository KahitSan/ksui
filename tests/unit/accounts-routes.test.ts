import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { QueryResult, QueryResultRow } from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildRouter, VALID_ICONS } from "../../server/routes-accounts.js";
import { stubMiddleware } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";

vi.mock("@kahitsan/plugin-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kahitsan/plugin-sdk")>();
  return {
    ...actual,
    tryCallPlugin: vi.fn().mockResolvedValue(null),
  };
});

const TEST_WORKSPACE = 3;

const ALL_PERMISSIONS = [
  "financial_accounts.view",
  "financial_accounts.create",
  "financial_accounts.edit",
  "financial_accounts.delete",
];

const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
  workspaceId: TEST_WORKSPACE,
  userId: "test-user-id",
  role: "superuser",
  wsRole: "admin",
  permissions: ALL_PERMISSIONS,
});

interface RecordedQuery {
  text: string;
  params: readonly unknown[];
}

function isClassifyQuery(text: string): boolean {
  return (
    text.includes("to_regclass") ||
    text.includes("pg_attribute") ||
    text.includes("pg_constraint")
  );
}

function recordingDb(
  dataRows:
    | QueryResultRow[]
    | ((text: string, params: readonly unknown[]) => QueryResultRow[]) = []
): PluginDb & { calls: RecordedQuery[] } {
  const calls: RecordedQuery[] = [];
  const resolveRows =
    typeof dataRows === "function"
      ? dataRows
      : () => (Array.isArray(dataRows) ? dataRows : []);

  const query = async <R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<QueryResult<R>> => {
    const p = params ?? [];
    if (isClassifyQuery(text)) {
      if (text.includes("to_regclass")) {
        return {
          rows: [{ oid: "12345" }] as unknown as R[],
          rowCount: 1,
        } as QueryResult<R>;
      }
      if (text.includes("pg_attribute")) {
        return {
          rows: [{ "?column?": 1 }] as unknown as R[],
          rowCount: 1,
        } as QueryResult<R>;
      }
      return { rows: [] as R[], rowCount: 0 } as QueryResult<R>;
    }
    calls.push({ text, params: p });
    const rows = resolveRows(text, p) as R[];
    return { rows, rowCount: rows.length } as QueryResult<R>;
  };

  return {
    calls,
    query,
    connect: async () => {
      throw new Error("recordingDb.connect() not used by the data surface");
    },
  } as unknown as PluginDb & { calls: RecordedQuery[] };
}

const TENANT_CTX = {
  wsId: TEST_WORKSPACE,
  userId: "test-user-id",
  role: "superuser",
  wsRole: "admin",
};

function makeApp(db = recordingDb()) {
  const router = buildRouter({
    db,
    requireAuth,
    requireWorkspace,
    requirePermission,
  });
  const app = new Hono();
  app.use("*", (_c, next) => runWithTenantContext(TENANT_CTX, () => next()));
  app.route("/", router);
  /** Wrap app.request in runWithTenantContext so ALS propagates to the data surface. */
  const doRequest = (path: string, init?: RequestInit) =>
    runWithTenantContext(TENANT_CTX, () => app.request(path, init));
  return { app, db, request: doRequest };
}

describe("VALID_ICONS", () => {
  it("is a non-empty readonly array of strings", () => {
    expect(Array.isArray(VALID_ICONS)).toBe(true);
    expect(VALID_ICONS.length).toBeGreaterThan(0);
    expect(VALID_ICONS.every((i: string) => typeof i === "string")).toBe(true);
  });

  it("contains the expected icon slugs", () => {
    expect(VALID_ICONS).toContain("banknote");
    expect(VALID_ICONS).toContain("landmark");
    expect(VALID_ICONS).toContain("wallet");
    expect(VALID_ICONS).toContain("coins");
  });
});

describe("POST / — create validation", () => {
  it("rejects empty body", async () => {
    const { request } = makeApp();
    const res = await request("/", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/name is required/i);
  });

  it("rejects missing type", async () => {
    const { request } = makeApp();
    const res = await request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Test Account" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/type must be one of/i);
  });

  it("rejects invalid type", async () => {
    const { request } = makeApp();
    const res = await request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Test", type: "crypto" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/type must be one of/i);
  });

  it("rejects invalid icon", async () => {
    const { request } = makeApp();
    const res = await request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Test", type: "bank", icon: "rocket" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/icon must be null or one of/i);
  });

  it("rejects invalid color format", async () => {
    const { request } = makeApp();
    const res = await request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Test", type: "bank", color: "red" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/color must be a 7-character hex/i);
  });

  it("rejects color with too few hex chars", async () => {
    const { request } = makeApp();
    const res = await request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Test", type: "bank", color: "#abc" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/color must be a 7-character hex/i);
  });

  it("accepts valid color with uppercase hex", async () => {
    const { db, request } = makeApp(
      recordingDb([
        { id: 1, workspace_id: 3, name: "Test", type: "bank", is_active: true },
      ])
    );
    const res = await request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Test", type: "bank", color: "#ABC123" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const createCall = db.calls.find((c) => c.text.includes("INSERT INTO"));
    expect(createCall).toBeDefined();
    expect(createCall!.params).toContain("#ABC123");
  });

  it("trims name before inserting", async () => {
    const { db, request } = makeApp(
      recordingDb([
        {
          id: 1,
          workspace_id: 3,
          name: "Trimmed",
          type: "bank",
          is_active: true,
        },
      ])
    );
    const res = await request("/", {
      method: "POST",
      body: JSON.stringify({ name: "  Trimmed  ", type: "bank" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const createCall = db.calls.find((c) => c.text.includes("INSERT INTO"));
    expect(createCall!.params).toContain("Trimmed");
  });

  it("passes null for omitted optional fields", async () => {
    const { db, request } = makeApp(
      recordingDb([
        {
          id: 1,
          workspace_id: 3,
          name: "Minimal",
          type: "cash",
          is_active: true,
        },
      ])
    );
    const res = await request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Minimal", type: "cash" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(201);
    const createCall = db.calls.find((c) => c.text.includes("INSERT INTO"));
    expect(createCall!.params).toContain(null);
    expect(createCall!.params).toContain(TEST_WORKSPACE);
  });

  it("sends 409 on unique violation", async () => {
    const uniqueError = Object.assign(new Error("duplicate key"), {
      code: "23505",
    });
    const db = recordingDb((text) => {
      if (text.includes("INSERT INTO")) throw uniqueError;
      return [];
    });
    const { request } = makeApp(db);
    const res = await request("/", {
      method: "POST",
      body: JSON.stringify({ name: "Dup", type: "bank" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });
});

describe("PUT /:id — update validation via buildUpdateAssignments", () => {
  it("rejects empty update (no fields)", async () => {
    const { request } = makeApp();
    const res = await request("/1", {
      method: "PUT",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no fields to update/i);
  });

  it("rejects invalid type in update", async () => {
    const { request } = makeApp();
    const res = await request("/1", {
      method: "PUT",
      body: JSON.stringify({ type: "bitcoin" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/type must be one of/i);
  });

  it("rejects invalid icon in update", async () => {
    const { request } = makeApp();
    const res = await request("/1", {
      method: "PUT",
      body: JSON.stringify({ icon: "spaceship" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/icon must be null or one of/i);
  });

  it("rejects invalid color in update", async () => {
    const { request } = makeApp();
    const res = await request("/1", {
      method: "PUT",
      body: JSON.stringify({ color: "not-a-color" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/color must be a 7-character hex/i);
  });

  it("rejects empty name in update", async () => {
    const { request } = makeApp();
    const res = await request("/1", {
      method: "PUT",
      body: JSON.stringify({ name: "" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/name cannot be empty/i);
  });

  it("rejects whitespace-only name in update", async () => {
    const { request } = makeApp();
    const res = await request("/1", {
      method: "PUT",
      body: JSON.stringify({ name: "   " }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/name cannot be empty/i);
  });

  it("accepts null icon (clears icon)", async () => {
    const { db, request } = makeApp(
      recordingDb([
        { id: 1, workspace_id: 3, name: "Acc", type: "bank", is_active: true },
      ])
    );
    const res = await request("/1", {
      method: "PUT",
      body: JSON.stringify({ icon: null }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const updateCall = db.calls.find(
      (c) => c.text.includes("UPDATE") && c.text.includes("financial_accounts")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall!.params).toContain(null);
  });

  it("accepts valid icon in update", async () => {
    const { db, request } = makeApp(
      recordingDb([
        { id: 1, workspace_id: 3, name: "Acc", type: "bank", is_active: true },
      ])
    );
    const res = await request("/1", {
      method: "PUT",
      body: JSON.stringify({ icon: "wallet" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const updateCall = db.calls.find(
      (c) => c.text.includes("UPDATE") && c.text.includes("financial_accounts")
    );
    expect(updateCall!.params).toContain("wallet");
  });

  it("sends 409 on unique violation during update", async () => {
    const uniqueError = Object.assign(new Error("duplicate key"), {
      code: "23505",
    });
    const db = recordingDb((text) => {
      if (text.includes("UPDATE")) throw uniqueError;
      return [];
    });
    const { request } = makeApp(db);
    const res = await request("/1", {
      method: "PUT",
      body: JSON.stringify({ name: "Dup" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });

  it("returns 404 when id does not match any row", async () => {
    const { request } = makeApp(recordingDb([]));
    const res = await request("/999999", {
      method: "PUT",
      body: JSON.stringify({ name: "Updated" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(404);
  });

  it("rejects non-numeric id", async () => {
    const { request } = makeApp();
    const res = await request("/abc", {
      method: "PUT",
      body: JSON.stringify({ name: "X" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid id/i);
  });
});

describe("GET /:id — detail", () => {
  it("returns 404 for non-existent id", async () => {
    const { request } = makeApp(recordingDb([]));
    const res = await request("/999999");
    expect(res.status).toBe(404);
  });

  it("returns account when found", async () => {
    const account = {
      id: 42,
      workspace_id: 3,
      name: "BDO Savings",
      type: "bank",
      is_active: true,
      description: "Main bank",
      icon: "landmark",
      color: "#0066cc",
      s3_link: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const { request } = makeApp(recordingDb([account]));
    const res = await request("/42");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(42);
    expect(body.name).toBe("BDO Savings");
  });

  it("passes the workspace from context to enforce org-scoping", async () => {
    const { db, request } = makeApp(recordingDb([{ id: 1 }]));
    await request("/1");
    const detailCall = db.calls.find(
      (c) => c.text.includes("FROM") && c.text.includes("financial_accounts")
    );
    expect(detailCall).toBeDefined();
    expect(detailCall!.text).toContain("workspace_id");
    expect(detailCall!.params).toContain(TEST_WORKSPACE);
  });
});

describe("DELETE /:id — archive", () => {
  it("returns 204 on successful archive", async () => {
    const { request } = makeApp(recordingDb([{ id: 10 }]));
    const res = await request("/10", { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  it("returns 404 when id not found", async () => {
    const { request } = makeApp(recordingDb([]));
    const res = await request("/999999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /:id/restore — restore", () => {
  it("returns restored account with is_active=true", async () => {
    const restored = {
      id: 10,
      workspace_id: 3,
      name: "Restored",
      is_active: true,
    };
    const { request } = makeApp(recordingDb([restored]));
    const res = await request("/10/restore", { method: "PATCH" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_active).toBe(true);
  });

  it("returns 404 when id not found", async () => {
    const { request } = makeApp(recordingDb([]));
    const res = await request("/999999/restore", { method: "PATCH" });
    expect(res.status).toBe(404);
  });
});

describe("GET / — list filter params", () => {
  it("defaults to active-only when no status param", async () => {
    const { db, request } = makeApp(recordingDb([]));
    await request("/");
    const listCall = db.calls.find(
      (c) => c.text.includes("FROM") && c.text.includes("financial_accounts")
    );
    expect(listCall!.text).toContain("is_active = true");
  });

  it("filters by archived status", async () => {
    const { db, request } = makeApp(recordingDb([]));
    await request("/?status=archived");
    const listCall = db.calls.find(
      (c) => c.text.includes("FROM") && c.text.includes("financial_accounts")
    );
    expect(listCall!.text).toContain("is_active = false");
  });

  it("applies search filter with ILIKE", async () => {
    const { db, request } = makeApp(recordingDb([]));
    await request("/?search=BDO");
    const listCall = db.calls.find((c) => c.text.includes("ILIKE"));
    expect(listCall).toBeDefined();
    expect(listCall!.params).toContain("%BDO%");
  });

  it("defaults to page=1 and limit=25", async () => {
    const { db, request } = makeApp(recordingDb([]));
    await request("/");
    const listCall = db.calls.find((c) => c.text.includes("LIMIT"));
    expect(listCall!.params).toContain(25);
    expect(listCall!.params).toContain(0);
  });

  it("clamps limit to max 200", async () => {
    const { db, request } = makeApp(recordingDb([]));
    await request("/?limit=999");
    const listCall = db.calls.find((c) => c.text.includes("LIMIT"));
    expect(listCall!.params).toContain(200);
  });

  it("sorts by name ASC when sortBy=name&sortDir=ASC", async () => {
    const { db, request } = makeApp(recordingDb([]));
    await request("/?sortBy=name&sortDir=ASC");
    const listCall = db.calls.find((c) => c.text.includes("ORDER BY"));
    expect(listCall!.text).toContain('ORDER BY "name" ASC');
  });

  it("falls back to created_at DESC for invalid sortBy", async () => {
    const { db, request } = makeApp(recordingDb([]));
    await request("/?sortBy=unknown_column");
    const listCall = db.calls.find((c) => c.text.includes("ORDER BY"));
    expect(listCall!.text).toContain(
      'ORDER BY "is_default_payment" DESC, "sort_order" ASC, "name" ASC, "id" ASC'
    );
  });

  it("supports explicit sort-order sorting", async () => {
    const { db, request } = makeApp(recordingDb([]));
    await request("/?sortBy=sort_order&sortDir=ASC");
    const listCall = db.calls.find((c) => c.text.includes("ORDER BY"));
    expect(listCall!.text).toContain('ORDER BY "sort_order" ASC');
  });
});

describe("PATCH /:id/payment-settings", () => {
  function settingsDb(
    rows: QueryResultRow[] = [{ id: 7 }]
  ): PluginDb & { calls: RecordedQuery[] } {
    const calls: RecordedQuery[] = [];
    const client = {
      query: vi.fn(async (text: string, params?: readonly unknown[]) => {
        calls.push({ text, params: params ?? [] });
        if (text.includes("RETURNING")) {
          return { rows, rowCount: rows.length };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    return {
      calls,
      query: async () =>
        ({ rows: [], rowCount: 0 } as unknown as QueryResult<QueryResultRow>),
      connect: async () => client,
    } as unknown as PluginDb & { calls: RecordedQuery[] };
  }

  it("sets a single workspace default and sort order", async () => {
    const db = settingsDb([
      {
        id: 7,
        workspace_id: TEST_WORKSPACE,
        name: "Cash on Office",
        type: "cash",
        is_default_payment: true,
        sort_order: 1,
      },
    ]);
    const { request } = makeApp(db);
    const res = await request("/7/payment-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default_payment: true, sort_order: 1 }),
    });
    expect(res.status).toBe(200);
    const clearCall = db.calls.find((c) => c.text.includes("id <> $2"));
    expect(clearCall).toBeDefined();
    expect(clearCall!.params).toEqual([TEST_WORKSPACE, 7]);
    const updateCall = db.calls.find((c) => c.text.includes("RETURNING"));
    expect(updateCall!.text).toContain("workspace_id = $1 AND id = $2");
    expect(updateCall!.params).toEqual([TEST_WORKSPACE, 7, true, 1]);
  });

  it("rejects invalid sort order", async () => {
    const { request } = makeApp(settingsDb());
    const res = await request("/7/payment-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default_payment: true, sort_order: -1 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/sort_order/i);
  });

  it("rejects non-boolean default flag", async () => {
    const { request } = makeApp(settingsDb());
    const res = await request("/7/payment-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default_payment: "yes", sort_order: 1 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/is_default_payment/i);
  });

  it("does not clear another account when unsetting default", async () => {
    const db = settingsDb([
      {
        id: 7,
        workspace_id: TEST_WORKSPACE,
        name: "Cash on Office",
        type: "cash",
        is_default_payment: false,
        sort_order: 2,
      },
    ]);
    const { request } = makeApp(db);
    const res = await request("/7/payment-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default_payment: false, sort_order: 2 }),
    });
    expect(res.status).toBe(200);
    expect(db.calls.some((c) => c.text.includes("id <> $2"))).toBe(false);
    const updateCall = db.calls.find((c) => c.text.includes("RETURNING"));
    expect(updateCall!.params).toEqual([TEST_WORKSPACE, 7, false, 2]);
  });

  it("returns 404 when the account is missing", async () => {
    const { request } = makeApp(settingsDb([]));
    const res = await request("/404/payment-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default_payment: true, sort_order: 1 }),
    });
    expect(res.status).toBe(404);
  });
});

describe("permission gate", () => {
  it("returns 403 when permissions are missing", async () => {
    const noPerms = stubMiddleware({
      workspaceId: 3,
      userId: "test",
      role: "admin",
      permissions: [],
    });
    const router = buildRouter({
      db: recordingDb(),
      ...noPerms,
    });
    const app = new Hono();
    const ctx = {
      wsId: TEST_WORKSPACE,
      userId: "test",
      role: "admin",
      wsRole: "admin",
    };
    app.use("*", (_c, next) => runWithTenantContext(ctx, () => next()));
    app.route("/", router);

    const res = await runWithTenantContext(ctx, () => app.request("/"));
    expect(res.status).toBe(403);
  });
});
