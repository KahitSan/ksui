import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { makeDatabaseService } from "@kahitsan/plugin-sdk";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";
import { makeDataSurface } from "@kahitsan/plugin-sdk";

// ── F3 band leak test (financial-accounts) ──────────────────────────────────
//
// Proves, against a REAL Postgres snapshot, that `makeDataSurface` over
// `accounts.financial_accounts` cannot read / mutate / delete another
// workspace's row, and that the RLS wall (`financial_accounts_org_isolation`)
// bites even a raw escapeHatch query. Runs under a NON-superuser role —
// `auth.is_superuser()` would otherwise satisfy the policy and RLS would
// (correctly) not clamp, so the wall must be tested as a plain member. The
// injected `AND workspace_id` filter is the primary gate; this asserts the
// second wall holds independently of it.
//
// Self-skips when the prerequisites (the table + its RLS policy + >=2
// workspaces) are absent, so a bare DB never false-fails.

const pool = new pg.Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "ks_erp",
});

const TAG = "__f3_fa_leak__";
let wsA = 0;
let wsB = 0;
let aRowId = 0;
let bRowId = 0;
const insertedIds: number[] = [];
let ready = false;

beforeAll(async () => {
  const ok = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_policies WHERE schemaname='accounts' AND tablename='financial_accounts'
                                   AND policyname='financial_accounts_org_isolation'
     ) AS exists`,
  );
  const ws = await pool.query<{ id: number }>(`SELECT id FROM workspaces ORDER BY id LIMIT 2`);
  if (!ok.rows[0]?.exists || ws.rows.length < 2) return;
  wsA = ws.rows[0].id;
  wsB = ws.rows[1].id;

  // Seed one account per workspace on the OWNER connection (bypasses RLS).
  // NOT NULL columns: workspace_id, name, type.
  const a = await pool.query<{ id: number }>(
    `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
       VALUES ($1, $2, $3) RETURNING id`,
    [wsA, `${TAG}-A`, "bank"],
  );
  const b = await pool.query<{ id: number }>(
    `INSERT INTO accounts.financial_accounts (workspace_id, name, type)
       VALUES ($1, $2, $3) RETURNING id`,
    [wsB, `${TAG}-B`, "bank"],
  );
  aRowId = a.rows[0].id;
  bRowId = b.rows[0].id;
  insertedIds.push(aRowId, bRowId);
  ready = true;
});

afterAll(async () => {
  if (insertedIds.length) {
    await pool.query(`DELETE FROM accounts.financial_accounts WHERE id = ANY($1::int[])`, [
      insertedIds,
    ]);
  }
  await pool
    .query(`DELETE FROM accounts.financial_accounts WHERE name LIKE $1`, [`${TAG}%`])
    .catch(() => {});
  await pool.end();
});

describe("F3 makeDataSurface over accounts.financial_accounts — cross-workspace leak (real Postgres + RLS)", () => {
  const makeSurface = () => makeDataSurface(makeDatabaseService(pool, ["accounts"]));
  // NON-superuser: a member, so RLS actually applies.
  const asA = <T>(fn: () => Promise<T>) =>
    runWithTenantContext({ wsId: wsA, userId: "uA", role: "member", wsRole: "member" }, fn);

  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(wsA).not.toBe(wsB);
    expect(aRowId).toBeGreaterThan(0);
    expect(bRowId).toBeGreaterThan(0);
  });

  it("find under A canNOT read B's account even when explicitly targeting B's id", async () => {
    if (!ready) return;
    const rows = await asA(() =>
      makeSurface().find("financial_accounts", ["id", "workspace_id", "name"], {
        where: "id = $1",
        params: [bRowId],
      }),
    );
    expect(rows).toEqual([]);
  });

  it("find under A returns A's own account (not vacuously empty)", async () => {
    if (!ready) return;
    const rows = await asA(() =>
      makeSurface().find<{ workspace_id: number }>("financial_accounts", ["id", "workspace_id"], {
        where: "id = $1",
        params: [aRowId],
      }),
    );
    expect(rows.map((r) => r.workspace_id)).toEqual([wsA]);
  });

  it("update under A canNOT mutate B's account (0 rows returned)", async () => {
    if (!ready) return;
    const updated = await asA(() =>
      makeSurface().update(
        "financial_accounts",
        { name: "hijacked" },
        { where: "id = $1", params: [bRowId] },
        ["id"],
      ),
    );
    expect(updated).toEqual([]);
    const check = await pool.query<{ name: string }>(
      `SELECT name FROM accounts.financial_accounts WHERE id=$1`,
      [bRowId],
    );
    expect(check.rows[0].name).toBe(`${TAG}-B`);
  });

  it("delete under A canNOT remove B's account (0 affected)", async () => {
    if (!ready) return;
    const n = await asA(() =>
      makeSurface().delete("financial_accounts", { where: "id = $1", params: [bRowId] }),
    );
    expect(n).toBe(0);
  });

  it("insert under A lands in A even if the caller forges workspace_id = B", async () => {
    if (!ready) return;
    const row = await asA(() =>
      makeSurface().insert<{ id: number; workspace_id: number }>(
        "financial_accounts",
        {
          name: `${TAG}-forge`,
          type: "bank",
          workspace_id: wsB,
        },
        ["id", "workspace_id"],
      ),
    );
    if (row) insertedIds.push(row.id);
    expect(row?.workspace_id).toBe(wsA);
  });

  it("escapeHatch raw query under A is STILL clamped by RLS (proves the wall, not just injection)", async () => {
    if (!ready) return;
    const result = await asA(() =>
      makeSurface()
        .escapeHatch()
        .query<{ id: number }>(
          "SELECT id FROM accounts.financial_accounts WHERE id = $1",
          [bRowId],
        ),
    );
    expect(result.rows).toEqual([]);
  });
});
