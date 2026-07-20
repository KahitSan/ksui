import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import pg from "pg";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { buildLineItemsRouter } from "../../server/routes-line-items.js";
import { todayInOrgTimezone } from "../../server/lib/backdate.js";
import { withRollbackDb, stubMiddleware } from "@kahitsan/plugin-sdk/test";
import { runWithTenantContext } from "@kahitsan/plugin-sdk";

// Regression for tx 7919: 6 independent time-bound line items sharing one
// transaction + client (each its own customer_group_id, distinct weekly
// windows, same package) must never share a combined_end — that bogus
// aggregate previously bucketed a today-dated line into the past and
// dropped it from every /api/transaction-line-items date-scope OR-arm.
// The fix scopes availment_groups to a run of CONTINUOUS OCCUPANCY per
// (transaction/client) ONLY — package_id is not in the key, because /extend
// allows a cross-package continuation — breaking a chain only on a real gap
// (started_at > previous ends_at). Unrelated bookings under one transaction
// stay separate; a genuine /extend chain still combines even across
// packages, and simultaneous siblings (identical started_at) combine too.

// package_id AND package_variant_id both carry a real FK in this shared
// schema (the plugin's own fresh migration doesn't declare either, but the
// worktree DB is prod-restored with the legacy monolith's constraints) —
// both rows are seeded below; findVariantsByIds is still mocked because the
// route resolves variant pricing/duration over the peers RPC, never a
// direct query against packages.package_variants. variantsById lets the
// cross-package /extend test return a variant bound to a DIFFERENT
// package_id than the source line's, which the single-fixed-packageId mock
// this replaced could never exercise.
let packageId: number;
let variantDbId: number;
let crossPackageId: number;
let crossVariantDbId: number;
const variantsById = new Map<number, { id: number; package_id: number }>();

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async (ids: number[]) =>
    ids
      .map((id) => variantsById.get(id))
      .filter((v): v is { id: number; package_id: number } => v != null)
      .map((v) => ({
        id: v.id,
        package_id: v.package_id,
        name: "Inner Area 11-Day Extension",
        kind: "standard",
        price: "0",
        currency: "PHP",
        duration_value: "11",
        duration_unit: "day",
        is_active: true,
      })) || null,
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async () => null,
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

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

const TEST_ORG = 7919;
const SCHEMAS = ["accounts", "clients"];

let honoApp: Hono;
let pool: pg.Pool;
let db: PluginDb;
let rollback: () => Promise<void>;
let userId: string;
let clientId: number;
let ready = false;

beforeAll(async () => {
  pool = new pg.Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "ks_erp",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    max: 3,
  });

  // packages.packages / clients.clients live in other plugins' schemas — a
  // bare CI database (this plugin's own migrations only create accounts.*)
  // doesn't have them, so probe before seeding or the suite 42P01s instead of
  // skipping cleanly.
  const schemaCheck = await pool.query<{ packages_ok: string | null; clients_ok: string | null }>(
    `SELECT to_regclass('packages.packages')::text AS packages_ok,
            to_regclass('clients.clients')::text AS clients_ok`,
  );
  if (!schemaCheck.rows[0]?.packages_ok || !schemaCheck.rows[0]?.clients_ok) {
    return;
  }

  await pool.query(
    `INSERT INTO public."user" (id, email, role, name)
     VALUES ('test-user-id', 'test@ci.local', 'superuser', 'CI User')
     ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO public.workspaces (id, name, slug)
     VALUES ($1, 'CI Workspace 7919', 'ci-ws-7919')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_ORG],
  );

  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM public."user" WHERE role = 'superuser' LIMIT 1`,
  );
  userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("integration test needs a real superuser in public.user");

  const rdb = await withRollbackDb(pool, SCHEMAS);
  db = rdb.db as unknown as PluginDb;
  rollback = rdb.rollback;

  // transaction_customer_groups.client_id carries a real FK into
  // clients.clients (a legacy monolith artifact this plugin treats as a soft
  // cross-plugin ref at the app layer — see cart-edit-fixtures.ts), so the
  // fixture needs a real row to reference.
  const clientRes = await db.query<{ id: number }>(
    `INSERT INTO clients.clients (workspace_id, name_raw) VALUES ($1, 'Combined Stay Test Client') RETURNING id`,
    [TEST_ORG],
  );
  clientId = clientRes.rows[0].id;

  // package_id carries a real FK into packages.packages in this shared
  // schema (see the module-header comment) — package_variant_id itself is
  // never inserted, only resolved over the mocked peers RPC.
  const pkgRes = await db.query<{ id: number }>(
    `INSERT INTO packages.packages (workspace_id, name, type, effective_from, lineage_slug)
     VALUES ($1, 'Combined Stay Test Package', 'daily', CURRENT_DATE, 'combined-stay-test-pkg')
     RETURNING id`,
    [TEST_ORG],
  );
  packageId = pkgRes.rows[0].id;

  // package_variant_id ALSO carries a real FK (same legacy-schema note above)
  // — the row's own duration/price fields are irrelevant since /extend
  // resolves variant details from the mocked peers RPC, never this row.
  const variantRes = await db.query<{ id: number }>(
    `INSERT INTO packages.package_variants
       (package_id, name, kind, duration_value, duration_unit, price, currency)
     VALUES ($1, 'Combined Stay Test Variant', 'standard', 11, 'day', 0, 'PHP')
     RETURNING id`,
    [packageId],
  );
  variantDbId = variantRes.rows[0].id;
  variantsById.set(variantDbId, { id: variantDbId, package_id: packageId });

  // A SECOND package + variant, distinct from the source line's package —
  // proves the cross-package /extend chain still combines now that
  // package_id is out of the chain key (rule #1).
  const crossPkgRes = await db.query<{ id: number }>(
    `INSERT INTO packages.packages (workspace_id, name, type, effective_from, lineage_slug)
     VALUES ($1, 'Combined Stay Cross Package', 'daily', CURRENT_DATE, 'combined-stay-cross-pkg')
     RETURNING id`,
    [TEST_ORG],
  );
  crossPackageId = crossPkgRes.rows[0].id;
  const crossVariantRes = await db.query<{ id: number }>(
    `INSERT INTO packages.package_variants
       (package_id, name, kind, duration_value, duration_unit, price, currency)
     VALUES ($1, 'Combined Stay Cross Variant', 'standard', 11, 'day', 0, 'PHP')
     RETURNING id`,
    [crossPackageId],
  );
  crossVariantDbId = crossVariantRes.rows[0].id;
  variantsById.set(crossVariantDbId, { id: crossVariantDbId, package_id: crossPackageId });

  const { requireAuth, requireWorkspace, requirePermission } = stubMiddleware({
    workspaceId: TEST_ORG,
    userId,
    role: "superuser",
    wsRole: "admin",
    permissions: ["transactions.view", "transactions.create", "transactions.edit"],
  });
  const router = buildLineItemsRouter({ db, requireAuth, requireWorkspace, requirePermission });
  honoApp = new Hono();
  honoApp.use("*", (_c, next) =>
    runWithTenantContext(
      { wsId: TEST_ORG, userId, role: "superuser", wsRole: "admin" },
      () => next(),
    ),
  );
  honoApp.route("/", router);
  ready = true;
});

afterAll(async () => {
  if (ready) {
    await rollback();
  }
  await pool.end();
});

let seedCounter = 0;

/**
 * Inserts a bare transaction (no customer group needed by these assertions).
 * Explicit Manila-today by default, not CURRENT_DATE: the test pool runs no
 * session TIMEZONE set, so a bare CURRENT_DATE resolves in the server/session's
 * own TZ (UTC in CI/local), which lags Asia/Manila by a day during
 * Manila's midnight-8am window — exactly the window this suite can run
 * in. Pinning the fixture's own transaction_date to the same
 * todayInOrgTimezone() the assertions query against keeps the test
 * deterministic regardless of wall-clock time. `transactionDate` overrides
 * this default — needed to pin a yesterday-dated receipt (the
 * combined_end-must-carry-the-line shape) so the CASE's own
 * `t.transaction_date` fallback can't accidentally rescue a line that a
 * broken chain grouping actually dropped.
 */
async function seedTransaction(transactionDate?: string): Promise<number> {
  const res = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date,
        status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 0, $2, $4::date, 'completed', $3, 0, 0)
     RETURNING id`,
    [
      TEST_ORG,
      `combined-stay-fixture-${Date.now()}-${seedCounter++}`,
      userId,
      transactionDate ?? todayInOrgTimezone(),
    ],
  );
  return res.rows[0].id;
}

/** Inserts one time-bound, non-voided line item with its own customer group. */
async function seedLine(
  transactionId: number,
  startedAt: Date,
  durationHours: number,
): Promise<{ lineItemId: number; customerGroupId: number }> {
  const endsAt = new Date(startedAt.getTime() + durationHours * 3_600_000);
  // is_payer stays FALSE for every group here: the unique partial index
  // idx_transaction_customer_groups_single_payer allows only one payer=TRUE
  // row per transaction_id, and payer semantics aren't under test.
  const cgRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, client_id, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, (SELECT COALESCE(MAX(position), -1) + 1 FROM accounts.transaction_customer_groups WHERE transaction_id = $1),
             $3, 'Payer', 0, 0, FALSE)
     RETURNING id`,
    [transactionId, TEST_ORG, clientId],
  );
  const customerGroupId = cgRes.rows[0].id;

  const liRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, client_id, customer_group_id)
     VALUES ($1, $2, $3, 'Inner Area 8h', 1, 0, $4, 'hour', $5, $6, 'active', $7, $8)
     RETURNING id`,
    [
      transactionId,
      TEST_ORG,
      packageId,
      durationHours,
      startedAt.toISOString(),
      endsAt.toISOString(),
      clientId,
      customerGroupId,
    ],
  );
  return { lineItemId: liRes.rows[0].id, customerGroupId };
}

/**
 * Inserts one line item with fully explicit started_at/ends_at/duration,
 * unlike seedLine's ends_at-from-duration convenience — needed to seed a
 * NULL-ends_at row (a real prod shape: duration_value/duration_unit set,
 * ends_at not yet computed) that seedLine can't express.
 */
async function seedLineExplicit(
  transactionId: number,
  startedAt: Date,
  endsAt: Date | null,
  durationValue: number | null,
  durationUnit: string | null,
): Promise<number> {
  const cgRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, client_id, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, (SELECT COALESCE(MAX(position), -1) + 1 FROM accounts.transaction_customer_groups WHERE transaction_id = $1),
             $3, 'Payer', 0, 0, FALSE)
     RETURNING id`,
    [transactionId, TEST_ORG, clientId],
  );
  const customerGroupId = cgRes.rows[0].id;
  const liRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, client_id, customer_group_id)
     VALUES ($1, $2, $3, 'Explicit line', 1, 0, $4, $5, $6, $7, 'active', $8, $9)
     RETURNING id`,
    [
      transactionId,
      TEST_ORG,
      packageId,
      durationValue,
      durationUnit,
      startedAt.toISOString(),
      endsAt ? endsAt.toISOString() : null,
      clientId,
      customerGroupId,
    ],
  );
  return liRes.rows[0].id;
}

/**
 * A past instant guaranteed to land on the same Asia/Manila calendar day as
 * the real NOW() Postgres evaluates, no matter when the suite runs. A fixed
 * `now - hoursAgo` offset crosses into Manila-yesterday during the first
 * `hoursAgo` hours after Manila midnight — on a UTC CI runner that window
 * hits daily at a fixed UTC time — so the offset is clamped to at most half
 * the elapsed time since Manila midnight, keeping the instant strictly
 * inside [Manila midnight, now) regardless of wall-clock time.
 */
function manilaSafePastInstant(hoursAgo: number): Date {
  const nowMs = Date.now();
  const manilaMidnightMs = new Date(`${todayInOrgTimezone(new Date(nowMs))}T00:00:00+08:00`).getTime();
  const elapsedMs = nowMs - manilaMidnightMs;
  const offsetMs = Math.min(hoursAgo * 3_600_000, elapsedMs / 2);
  return new Date(nowMs - offsetMs);
}

describe("GET /api/transaction-line-items — independent same-transaction bookings (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("never merges 6 distinct weekly bookings into one combined_end, and today's line stays visible", async () => {
    if (!ready) return;
    const transactionId = await seedTransaction();
    const now = Date.now();
    const dayMs = 86_400_000;
    // Mirrors tx 7919: 6 independent 8h sessions, same transaction + client +
    // package, non-contiguous weekly-ish windows spanning past/today/future.
    const offsetsDays = [-30, -23, -16, -9, 0, 7];
    const ids: number[] = [];
    let todayLineId = -1;
    for (const offsetDays of offsetsDays) {
      const startedAt =
        offsetDays === 0
          ? new Date(now - 3_600_000) // in progress right now
          : new Date(now + offsetDays * dayMs);
      const { lineItemId } = await seedLine(transactionId, startedAt, 8);
      ids.push(lineItemId);
      if (offsetDays === 0) todayLineId = lineItemId;
    }
    expect(todayLineId).toBeGreaterThan(0);

    const today = todayInOrgTimezone();
    const res = await request(
      honoApp,
      "GET",
      `/api/transaction-line-items?active_on=${today}&include_upcoming=true`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const returnedIds = new Set((body.data as Array<{ id: number }>).map((r) => r.id));

    // The bug dropped exactly the today-dated line; assert it — and every
    // sibling — survives, proving no bogus cross-booking combined_end pushed
    // any line's date bucket out of scope.
    for (const id of ids) {
      expect(returnedIds.has(id), `line ${id} (offsets ${offsetsDays}) must be visible`).toBe(true);
    }
    expect(returnedIds.size).toBe(6);
  });
});

describe("GET /api/transaction-line-items — genuine /extend chain still combines (real Postgres)", () => {
  it("a source line whose own window already ended stays bucketed as today when a live extension continues it", async () => {
    if (!ready) return;
    const transactionId = await seedTransaction();
    const now = Date.now();
    const dayMs = 86_400_000;
    // Source window: fully 10 days in the past on its own (own ends_at bucket
    // would be 9 days ago) — only combining with the extension's future end
    // (source runs 24h from 10 days ago, extension continues 11 more days,
    // landing ~2 days from now) keeps it inside "today".
    const sourceStartedAt = new Date(now - 10 * dayMs);
    const { lineItemId: sourceId } = await seedLine(transactionId, sourceStartedAt, 24);

    const extendRes = await request(
      honoApp,
      "POST",
      `/api/transaction-line-items/${sourceId}/extend`,
      { package_variant_id: variantDbId, quantity: 1 },
    );
    expect(extendRes.status).toBe(201);

    const today = todayInOrgTimezone();
    // include_carryover=false + include_upcoming=false isolates the
    // today's-transaction CASE arm so only ag.combined_end (not the
    // carryover EXISTS arm) can explain the source line surviving.
    const res = await request(
      honoApp,
      "GET",
      `/api/transaction-line-items?active_on=${today}&include_carryover=false&include_upcoming=false`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const returnedIds = new Set((body.data as Array<{ id: number }>).map((r) => r.id));
    expect(returnedIds.has(sourceId)).toBe(true);
  });

  it("a cross-package /extend (variant bound to a DIFFERENT package_id) still combines", async () => {
    if (!ready) return;
    const transactionId = await seedTransaction();
    const now = Date.now();
    const dayMs = 86_400_000;
    const sourceStartedAt = new Date(now - 10 * dayMs);
    const { lineItemId: sourceId } = await seedLine(transactionId, sourceStartedAt, 24);

    // crossVariantDbId resolves (via the mocked peers RPC) to crossPackageId
    // — a package distinct from the source line's own packageId. Rule #1
    // (package_id excluded from the chain key) must still combine this.
    const extendRes = await request(
      honoApp,
      "POST",
      `/api/transaction-line-items/${sourceId}/extend`,
      { package_variant_id: crossVariantDbId, quantity: 1 },
    );
    expect(extendRes.status).toBe(201);

    const today = todayInOrgTimezone();
    const res = await request(
      honoApp,
      "GET",
      `/api/transaction-line-items?active_on=${today}&include_carryover=false&include_upcoming=false`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const returnedIds = new Set((body.data as Array<{ id: number }>).map((r) => r.id));
    expect(returnedIds.has(sourceId)).toBe(true);
  });
});

describe("GET /api/transaction-line-items — simultaneous siblings combine (real Postgres)", () => {
  it("two lines sharing one started_at (base + extension charged together) combine, not chain_size 1", async () => {
    if (!ready) return;
    const transactionId = await seedTransaction();
    const now = Date.now();
    const dayMs = 86_400_000;
    // Both lines transaction-fixed at the SAME started_at (mirrors
    // insert-line-items.ts inserting every line of a charge at one NOW()).
    // Base line's own window (10 days ago + 1h) is deep in the past; only
    // rule #3 (equal-start CONTINUES the chain, never breaks it) lets the
    // sibling's much longer duration roll the combined_end into today.
    const sharedStartedAt = new Date(now - 10 * dayMs);
    const { lineItemId: baseId } = await seedLine(transactionId, sharedStartedAt, 1);
    await seedLine(transactionId, sharedStartedAt, 241);

    const today = todayInOrgTimezone();
    const res = await request(
      honoApp,
      "GET",
      `/api/transaction-line-items?active_on=${today}&include_carryover=false&include_upcoming=false`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const returnedIds = new Set((body.data as Array<{ id: number }>).map((r) => r.id));
    // Pre-fix (`IS NOT DISTINCT FROM` equality test): both lines are
    // chain_size 1, combined_end is NULL, the base line vanishes from today.
    expect(returnedIds.has(baseId), "base line must survive via the combined chain").toBe(true);
  });
});

describe("GET /api/transaction-line-items — tied started_at grouping is deterministic (real Postgres)", () => {
  it("repeated identical requests return the same visible set for tied-start siblings", async () => {
    if (!ready) return;
    const transactionId = await seedTransaction();
    const now = Date.now();
    const dayMs = 86_400_000;
    const sharedStartedAt = new Date(now - 10 * dayMs);
    // Three lines at the identical started_at: without the (started_at,
    // ends_at, id) total order in every window, LAG can compare against an
    // arbitrary neighbour and the planner-chosen row order can flip the
    // chain assignment between runs.
    const seeded = await Promise.all([
      seedLine(transactionId, sharedStartedAt, 1),
      seedLine(transactionId, sharedStartedAt, 2),
      seedLine(transactionId, sharedStartedAt, 241),
    ]);
    const seededIds = seeded.map((s) => s.lineItemId);

    const today = todayInOrgTimezone();
    const query = `/api/transaction-line-items?active_on=${today}&include_carryover=false&include_upcoming=false`;
    const first = await (await request(honoApp, "GET", query)).json();
    const second = await (await request(honoApp, "GET", query)).json();
    const firstIds = new Set((first.data as Array<{ id: number }>).map((r) => r.id));
    const secondIds = new Set((second.data as Array<{ id: number }>).map((r) => r.id));

    for (const id of seededIds) {
      expect(firstIds.has(id), `line ${id} must be visible on the first request`).toBe(true);
      expect(secondIds.has(id), `line ${id} must be visible on the second (repeated) request`).toBe(
        true,
      );
    }
  });
});

describe("GET /api/transaction-line-items — nested shorter sibling doesn't reset the chain frontier (real Postgres)", () => {
  it("A(1h) + B(15min nested inside A) + C(continues off A's real end) all combine, keeping A in today", async () => {
    if (!ready) return;
    const transactionId = await seedTransaction();
    const now = Date.now();
    const dayMs = 86_400_000;
    const hourMs = 3_600_000;
    // A: 10 days ago, 1h. B: nested INSIDE A's window (30min in, 15min long)
    // — a LAG-based break test compares C against B's earlier-ending window
    // instead of the chain's running max (A's later end), splitting a chain
    // that is still continuously covered. C continues exactly off A's real
    // end and runs long enough to land back in "today".
    const aStart = new Date(now - 10 * dayMs);
    const aEnd = new Date(aStart.getTime() + hourMs);
    const bStart = new Date(aStart.getTime() + 30 * 60_000);
    const bEnd = new Date(bStart.getTime() + 15 * 60_000);
    const cStart = aEnd;
    const cEnd = new Date(cStart.getTime() + 264 * hourMs); // 11 days — lands in the future

    const aId = await seedLineExplicit(transactionId, aStart, aEnd, 1, "hour");
    await seedLineExplicit(transactionId, bStart, bEnd, 0.25, "hour");
    await seedLineExplicit(transactionId, cStart, cEnd, 264, "hour");

    const today = todayInOrgTimezone();
    // include_carryover=false + include_upcoming=false isolates the
    // combined_end-driven CASE arm — the carryover EXISTS arm would rescue A
    // via C's future ends_at regardless of chain grouping, hiding the bug.
    const res = await request(
      honoApp,
      "GET",
      `/api/transaction-line-items?active_on=${today}&include_carryover=false&include_upcoming=false`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const returnedIds = new Set((body.data as Array<{ id: number }>).map((r) => r.id));
    // Pre-fix (LAG frontier): C breaks against B's 09:45-equivalent end, so
    // A+B's own combined_end sums to only 1.25h past aStart — deep in the
    // past — and A drops off /counter while the real chain (through C) is
    // still running.
    expect(returnedIds.has(aId), "A must survive via the true A+B+C chain").toBe(true);
  });
});

describe("GET /api/transaction-line-items — a NULL-ends_at sibling doesn't force a spurious break (real Postgres)", () => {
  it("P(1h) + Q(NULL ends_at, duration set) + R(continues off P's real end) still combine", async () => {
    if (!ready) return;
    const transactionId = await seedTransaction();
    const now = Date.now();
    const dayMs = 86_400_000;
    const hourMs = 3_600_000;
    // Q has duration_value/duration_unit set (qualifies for the base CTE)
    // but ends_at NULL — a real prod shape (e.g. an open-ended entry). A
    // LAG-based break test sees LAG(ends_at) IS NULL for the row right after
    // Q and forces chain_break=1 unconditionally, even though R actually
    // continues cleanly from P's real end.
    const pStart = new Date(now - 10 * dayMs);
    const pEnd = new Date(pStart.getTime() + hourMs);
    const qStart = new Date(pStart.getTime() + 20 * 60_000);
    const rStart = pEnd;
    const rEnd = new Date(rStart.getTime() + 264 * hourMs); // 11 days — lands in the future

    const pId = await seedLineExplicit(transactionId, pStart, pEnd, 1, "hour");
    await seedLineExplicit(transactionId, qStart, null, 5, "hour");
    await seedLineExplicit(transactionId, rStart, rEnd, 264, "hour");

    const today = todayInOrgTimezone();
    const res = await request(
      honoApp,
      "GET",
      `/api/transaction-line-items?active_on=${today}&include_carryover=false&include_upcoming=false`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const returnedIds = new Set((body.data as Array<{ id: number }>).map((r) => r.id));
    // Pre-fix: R's LAG-forced break isolates it into its own chain_size-1
    // group, leaving P+Q's combined_end deep in the past and dropping P.
    expect(returnedIds.has(pId), "P must survive via the true P+Q+R chain").toBe(true);
  });

  it("Q(NULL ends_at, sorts first) + R(real ends_at, continues) still combine", async () => {
    if (!ready) return;
    const now = Date.now();
    const dayMs = 86_400_000;
    const hourMs = 3_600_000;
    // Receipt dated YESTERDAY, not today: a broken chain would leave Q with
    // no ag.combined_end AND no li.ends_at of its own (it's the open-ended
    // row), so the CASE's ELSE falls all the way to t.transaction_date — if
    // that fallback were today (the seedTransaction default), Q would
    // "survive" for the wrong reason and the test couldn't tell a real chain
    // combine from an accidental default-bucket rescue.
    const transactionId = await seedTransaction(todayInOrgTimezone(new Date(now - dayMs)));
    // Q is the genuine FIRST row of the partition (earliest started_at) with
    // ends_at NULL. The two-state CASE (empty frame vs MAX-is-null frame)
    // collapses to the same "MAX(ends_at) OVER w IS NULL" test for both Q
    // (empty frame — correctly starts a chain) and R (frame = {Q}, frontier
    // NULL — must NOT break) — without distinguishing them, R also breaks,
    // isolating it into its own chain_size-1 group and leaving Q's own
    // window (deep in the past, no duration on its own) to vanish alone.
    // The route's combined_end is MIN(started_at) + SUM(durations), i.e.
    // qStart + 239h (Q's 1h + R's 238h) — NOT rEnd. Anchor the SUM directly
    // so combined_end lands exactly on the clamped safe-past instant instead
    // of drifting past it (which would put combined_end in the future for
    // part of the day and flip the CASE arm the test relies on).
    const combinedEnd = manilaSafePastInstant(1);
    const qStart = new Date(combinedEnd.getTime() - 239 * hourMs);
    const rStart = new Date(qStart.getTime() + 20 * 60_000);
    const rEnd = new Date(rStart.getTime() + 238 * hourMs);

    const qId = await seedLineExplicit(transactionId, qStart, null, 1, "hour");
    await seedLineExplicit(transactionId, rStart, rEnd, 238, "hour");

    const today = todayInOrgTimezone();
    const res = await request(
      honoApp,
      "GET",
      `/api/transaction-line-items?active_on=${today}&include_carryover=false&include_upcoming=false`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const returnedIds = new Set((body.data as Array<{ id: number }>).map((r) => r.id));
    // Pre-fix: the collapsed two-state CASE breaks R against Q too, so Q's
    // own chain_size-1 group has no combined_end, no ends_at of its own, and
    // falls back to the yesterday-dated t.transaction_date — dropping Q from
    // today's scope.
    expect(returnedIds.has(qId), "Q must survive via the true Q+R chain").toBe(true);
  });
});

describe("GET /api/transaction-line-items — a non-time-bound sibling inherits its subgroup's combined_end (real Postgres)", () => {
  it("chain A+B ending today + a no-duration retail line on the same receipt are all returned", async () => {
    if (!ready) return;
    const now = Date.now();
    const dayMs = 86_400_000;
    const hourMs = 3_600_000;
    // Receipt dated YESTERDAY (the reviewer's exact probe shape): the retail
    // line's own started_at is set but ends_at/duration are NULL, so a
    // failed subgroup match falls all the way to the CASE's ELSE
    // (t.transaction_date) — pinning that to yesterday means the retail
    // line only survives today's query by genuinely inheriting the chain's
    // combined_end, not by an accidental today-dated fallback.
    const transactionId = await seedTransaction(todayInOrgTimezone(new Date(now - dayMs)));
    // Chain: A started, B continues off A's real end — combined_end anchored
    // ~3h before NOW() (clamped to stay inside Manila-today), already-ended
    // but still dated TODAY.
    const bEnd = manilaSafePastInstant(3);
    const bStart = new Date(bEnd.getTime() - hourMs);
    const aEnd = bStart;
    const aStart = new Date(aEnd.getTime() - hourMs);
    const aId = await seedLineExplicit(transactionId, aStart, aEnd, 1, "hour");
    const bId = await seedLineExplicit(transactionId, bStart, bEnd, 1, "hour");

    // Retail add-on: started_at set (transaction-fixed anchor, same as
    // insert-line-items.ts:121), no duration/ends_at — never joins the
    // per-chain aggregate directly, so it must fall back to the subgroup's
    // combined_end via subgroup_combined_end.
    const retailId = await seedLineExplicit(transactionId, aStart, null, null, null);

    const today = todayInOrgTimezone();
    const res = await request(
      honoApp,
      "GET",
      `/api/transaction-line-items?active_on=${today}&include_carryover=false&include_upcoming=false`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const returnedIds = new Set((body.data as Array<{ id: number }>).map((r) => r.id));
    // Pre-fix: the id-only join on line_combined_end never matches the
    // retail line (it has no duration_value to qualify for the chain CTE at
    // all), so it inherits nothing and vanishes from today's date scope.
    expect(returnedIds.has(aId), "chain member A must be returned").toBe(true);
    expect(returnedIds.has(bId), "chain member B must be returned").toBe(true);
    expect(returnedIds.has(retailId), "the non-time-bound retail line must be returned").toBe(true);
  });
});
