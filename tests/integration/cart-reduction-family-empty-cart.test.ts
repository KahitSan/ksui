import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// Regression test for tx #8843: a cashier zeroes ALL of a parent's own lines
// after redistributing them to other customers via /charge (each addition is
// a CHILD transaction with parent_transaction_id set). The EMPTY_CART guard
// must look at the whole receipt FAMILY (parent + non-voided children), not
// just the parent's own remaining lines.

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

const TEST_ORG = 48;
const OTHER_ORG = 49;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-48");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

/** Seeds a parent sale with `lineCount` active lines, all targetable by a single reduction to zero. */
async function seedParentWithLines(lineCount: number): Promise<{ transactionId: number; lineIds: number[] }> {
  const amount = 500 * lineCount;
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', $2, $3, CURRENT_DATE, 'completed', $4, $2, 0)
     RETURNING id`,
    [TEST_ORG, amount, `cart-reduction-family-parent-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const lineIds: number[] = [];
  for (let i = 0; i < lineCount; i++) {
    const lineRes = await db.query<{ id: number }>(
      `INSERT INTO accounts.transaction_line_items
         (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
          duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
       VALUES ($1, $2, $3, $4, $5, 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', NULL)
       RETURNING id`,
      [transactionId, TEST_ORG, packageId, variantAId, `Original line ${i}`],
    );
    lineIds.push(lineRes.rows[0].id);
  }

  return { transactionId, lineIds };
}

/** Seeds a child transaction (parent_transaction_id set) with one line, in the given workspace. */
async function seedChild(
  parentTransactionId: number,
  opts: { workspaceId?: number; childStatus?: string; lineStatus?: string } = {},
): Promise<{ transactionId: number; lineId: number }> {
  const workspaceId = opts.workspaceId ?? TEST_ORG;
  const childStatus = opts.childStatus ?? "completed";
  const lineStatus = opts.lineStatus ?? "active";
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by,
        subtotal, discount_amount, parent_transaction_id)
     VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE, $3, $4, 500, 0, $5)
     RETURNING id`,
    [
      workspaceId,
      `cart-reduction-family-child-${Date.now()}-${seedCounter++}`,
      childStatus,
      "test-user-id",
      parentTransactionId,
    ],
  );
  const transactionId = txnRes.rows[0].id;

  const lineRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Redistributed line', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), $5, NULL)
     RETURNING id`,
    [transactionId, workspaceId, packageId, variantAId, lineStatus],
  );

  return { transactionId, lineId: lineRes.rows[0].id };
}

async function zeroOutParent(transactionId: number) {
  return request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
    edit_token: crypto.randomUUID(),
    reason: "Redistributed to other customers",
    reductions: [
      { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
    ],
  });
}

describe("POST /:id/apply-cart-edit — family-aware EMPTY_CART guard (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("(a) allows zeroing the parent's lines when a non-voided child still has an active line", async () => {
    if (!ready) return;
    const { transactionId, lineIds } = await seedParentWithLines(2);
    const child = await seedChild(transactionId);

    const res = await zeroOutParent(transactionId);
    expect(res.status).toBe(200);

    const lines = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = ANY($1)`,
      [lineIds],
    );
    expect(lines.rows.every((r) => r.status === "voided")).toBe(true);

    const childLine = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [child.lineId],
    );
    expect(childLine.rows[0].status).toBe("active");
  });

  it("(b) still 409s EMPTY_CART when the parent has no child at all, and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, lineIds } = await seedParentWithLines(1);

    const res = await zeroOutParent(transactionId);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("EMPTY_CART");

    const lines = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = ANY($1)`,
      [lineIds],
    );
    expect(lines.rows.every((r) => r.status === "completed")).toBe(true);

    const editRows = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_edits WHERE transaction_id = $1 AND kind = 'cart_reduction'`,
      [transactionId],
    );
    expect(editRows.rows[0].n).toBe("0");
  });

  it("(c) still 409s EMPTY_CART when the only child is voided", async () => {
    if (!ready) return;
    const { transactionId, lineIds } = await seedParentWithLines(1);
    await seedChild(transactionId, { childStatus: "voided" });

    const res = await zeroOutParent(transactionId);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("EMPTY_CART");

    const lines = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = ANY($1)`,
      [lineIds],
    );
    expect(lines.rows.every((r) => r.status === "completed")).toBe(true);
  });

  it("(d) a child in a DIFFERENT workspace does not count toward the family", async () => {
    if (!ready) return;
    // `db` (not the raw `pool`) shares the single connection/transaction the
    // route itself runs on (see cart-edit-fixtures withRollbackDb), so a row
    // seeded here is visible to the route's queries within this test.
    await db.query(
      `INSERT INTO public.workspaces (id, name, slug) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
      [OTHER_ORG, `CI Workspace ${OTHER_ORG}`, "ci-ws-49"],
    );
    const { transactionId, lineIds } = await seedParentWithLines(1);
    await seedChild(transactionId, { workspaceId: OTHER_ORG });

    const res = await zeroOutParent(transactionId);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("EMPTY_CART");

    const lines = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = ANY($1)`,
      [lineIds],
    );
    expect(lines.rows.every((r) => r.status === "completed")).toBe(true);
  });
});
