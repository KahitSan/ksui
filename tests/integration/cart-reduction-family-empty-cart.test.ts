import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// Was the family-aware EMPTY_CART guard (tx #8843): additions used to land on
// a CHILD transaction (parent_transaction_id set) via /charge, so the guard
// unioned the parent's own lines with any non-voided child's lines. Per
// SAME-TX-EDIT-BRIEF.md, additions now land on the SAME transaction_id and
// that union is deleted — so a child's lines no longer rescue an otherwise-
// empty parent. This file is REWRITTEN (not deleted) to pin that the
// simplified single-table guard actually behaves this way, rather than
// leaving assertions for the deleted child-union behavior in place.

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

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;
let variantBId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-48");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
  variantBId = fx.variantBId;
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

/** Seeds a legacy-shaped child transaction (parent_transaction_id set) with one line. */
async function seedChild(
  parentTransactionId: number,
  opts: { childStatus?: string; lineStatus?: string } = {},
): Promise<{ transactionId: number; lineId: number }> {
  const childStatus = opts.childStatus ?? "completed";
  const lineStatus = opts.lineStatus ?? "active";
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by,
        subtotal, discount_amount, parent_transaction_id)
     VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE, $3, $4, 500, 0, $5)
     RETURNING id`,
    [
      TEST_ORG,
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
    [transactionId, TEST_ORG, packageId, variantAId, lineStatus],
  );

  return { transactionId, lineId: lineRes.rows[0].id };
}

async function zeroOutParent(transactionId: number) {
  return request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
    edit_token: crypto.randomUUID(),
    reason: "Zero the parent's own lines",
    reductions: [
      { customer_group_id: null, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
    ],
  });
}

describe("POST /:id/apply-cart-edit — same-tx-only EMPTY_CART guard (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("409s EMPTY_CART even when a linked (parent_transaction_id-carrying) transaction has an active line", async () => {
    if (!ready) return;
    const { transactionId, lineIds } = await seedParentWithLines(1);
    const child = await seedChild(transactionId);

    const res = await zeroOutParent(transactionId);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("EMPTY_CART");

    const lines = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = ANY($1)`,
      [lineIds],
    );
    expect(lines.rows.every((r) => r.status === "completed")).toBe(true);

    const childLine = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [child.lineId],
    );
    expect(childLine.rows[0].status).toBe("active");
  });

  it("409s EMPTY_CART when the parent has no linked transaction at all, and mutates nothing", async () => {
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

  it("passes when the parent still has an active line of its OWN left over, regardless of any linked transaction", async () => {
    if (!ready) return;
    const { transactionId, lineIds } = await seedParentWithLines(1);
    // A second, DIFFERENT-package line on the parent itself — the guard must
    // still see this one after the reduction voids the first, independent of
    // whatever a linked transaction carries.
    const otherLine = await db.query<{ id: number }>(
      `INSERT INTO accounts.transaction_line_items
         (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
          duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
       VALUES ($1, $2, $3, $4, 'Other line', 1, 300, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'active', NULL)
       RETURNING id`,
      [transactionId, TEST_ORG, packageId, variantBId],
    );
    await seedChild(transactionId, { childStatus: "voided" });

    const res = await zeroOutParent(transactionId);
    expect(res.status).toBe(200);

    const voidedLines = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = ANY($1)`,
      [lineIds],
    );
    expect(voidedLines.rows.every((r) => r.status === "voided")).toBe(true);

    const survivingLine = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE id = $1`,
      [otherLine.rows[0].id],
    );
    expect(survivingLine.rows[0].status).toBe("active");
  });
});
