import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// SAME-TX-EDIT-BRIEF.md test 7: a forced failure mid-additions rolls back
// the ENTIRE call — zero new customer_group rows, zero new line items,
// original reductions un-applied.
//
// A shape-invalid package_variant_id (<=0) still only ever produces a
// pre-BEGIN 400 with zero DB writes — trivially atomic, but not a
// "mid-additions" DB rollback. Since B5, package_variant_id also goes
// through a real findVariantsByIds RPC resolve before BEGIN (mocked below),
// so the first `it` exercises the shape-check 400 specifically; the second
// forces a genuine mid-transaction ROLLBACK via a second addition entry that
// targets a customer_group_id belonging to a DIFFERENT transaction — that
// check only runs inside BEGIN, after the first addition/reduction already
// mutated rows in the same DB transaction, so it actually exercises the
// ROLLBACK path.

// Resolved lazily by id (set from the real seeded fixture rows in beforeAll)
// so the pre-BEGIN findVariantsByIds RPC the route now makes (B5) returns a
// real variant instead of forcing every addition through the plugin-absent
// 503 path.
let variantAIdForMock = 0;
let packageIdForMock = 0;

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async (ids: number[]) =>
    ids.flatMap((id) =>
      id === variantAIdForMock
        ? [{ id, package_id: packageIdForMock, name: "Call Booth", kind: "standard", price: "500.00", currency: "PHP", duration_value: "1", duration_unit: "hour", is_active: true }]
        : [],
    ),
  findPackagesByIds: async () => null,
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async () => null,
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 306;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-306");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
  packageIdForMock = fx.packageId;
  variantAIdForMock = fx.variantAId;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

async function seedSale(): Promise<{ transactionId: number; groupId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE, 'completed', $3, 500, 0)
     RETURNING id`,
    [TEST_ORG, `cart-edit-atomic-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const cg = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Payer', 500, 0, TRUE) RETURNING id`,
    [transactionId, TEST_ORG],
  );

  await db.query(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Original', 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'completed', $5)`,
    [transactionId, TEST_ORG, packageId, variantAId, cg.rows[0].id],
  );

  return { transactionId, groupId: cg.rows[0].id };
}

describe("POST /:id/apply-cart-edit — atomicity of a mixed reduce+add call (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("a shape-invalid package_variant_id in the second addition 400s before touching the DB", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Attempted swap",
      reductions: [
        { customer_group_id: groupId, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
      additions: [
        {
          customer_group_id: groupId,
          items: [
            {
              package_variant_id: variantAId,
              quantity: 1,
              anchor: "now",
            },
          ],
        },
        {
          customer_group_id: groupId,
          items: [
            {
              package_variant_id: -1,
              quantity: 1,
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(400);

    const cgCount = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_customer_groups WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(cgCount.rows[0].n).toBe("1");

    const lines = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(lines.rows.length).toBe(1);
    expect(lines.rows[0].status).toBe("completed");
  });

  it("a mid-transaction failure (second addition's cg belongs to a different transaction) rolls back everything", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSale();
    const other = await seedSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Attempted swap",
      reductions: [
        { customer_group_id: groupId, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
      additions: [
        {
          customer_group_id: null,
          new_group: { client_id: null, display_name: "New Guest", note: null, voucher_id: null, started_at: null },
          items: [
            {
              package_variant_id: variantAId,
              quantity: 1,
              anchor: "now",
            },
          ],
        },
        {
          customer_group_id: other.groupId,
          items: [
            {
              package_variant_id: variantAId,
              quantity: 1,
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(404);

    // Original reduction un-applied.
    const originalLines = await db.query<{ status: string }>(
      `SELECT status FROM accounts.transaction_line_items WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(originalLines.rows.length).toBe(1);
    expect(originalLines.rows[0].status).toBe("completed");

    // No new cg or line item from the first addition entry either.
    const cgCount = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_customer_groups WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(cgCount.rows[0].n).toBe("1");
  });

  // Fold-in: an addition-only call (no reduction alongside it) targeting a
  // customer_group_id that belongs to a DIFFERENT transaction in the SAME
  // workspace 404s and mutates nothing — isolates the guard from the
  // combined reduce+add path above.
  it("an addition-only call targeting a different transaction's customer_group_id 404s and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId } = await seedSale();
    const other = await seedSale();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Attempted cross-transaction addition",
      additions: [
        {
          customer_group_id: other.groupId,
          items: [
            {
              package_variant_id: variantAId,
              quantity: 1,
              anchor: "now",
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(404);

    const cgCount = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_customer_groups WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(cgCount.rows[0].n).toBe("1");

    const lines = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_line_items WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(lines.rows[0].n).toBe("1");

    const otherLines = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_line_items WHERE transaction_id = $1`,
      [other.transactionId],
    );
    expect(otherLines.rows[0].n).toBe("1");
  });
});
