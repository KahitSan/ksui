import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// SAME-TX-EDIT-BRIEF.md test 6: a new-package addition (anchor "now") lands
// with started_at ~= NOW(); a true-extension addition
// (anchor: { chain_from_line_id }) lands with started_at equal to the source
// line's ends_at, matching /extend's existing chain behavior — and a
// chain_from_line_id pointing at a DIFFERENT transaction is rejected with
// 400/404 (server resolves the anchor; the client never sends an ISO).

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

const TEST_ORG = 305;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-305");
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

async function seedSaleWithFutureEndsAt(): Promise<{ transactionId: number; groupId: number; lineId: number; endsAt: string }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE, 'completed', $3, 500, 0)
     RETURNING id`,
    [TEST_ORG, `cart-edit-anchor-${Date.now()}-${seedCounter++}`, "test-user-id"],
  );
  const transactionId = txnRes.rows[0].id;

  const cg = await db.query<{ id: number }>(
    `INSERT INTO accounts.transaction_customer_groups
       (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
     VALUES ($1, $2, 0, 'Payer', 500, 0, TRUE) RETURNING id`,
    [transactionId, TEST_ORG],
  );

  const line = await db.query<{ id: number; ends_at: string }>(
    `INSERT INTO accounts.transaction_line_items
       (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
        duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
     VALUES ($1, $2, $3, $4, 'Booked hour', 1, 500, 1, 'hour', NOW(), NOW() + INTERVAL '2 hours', 'active', $5)
     RETURNING id, ends_at`,
    [transactionId, TEST_ORG, packageId, variantAId, cg.rows[0].id],
  );

  return { transactionId, groupId: cg.rows[0].id, lineId: line.rows[0].id, endsAt: line.rows[0].ends_at };
}

describe("POST /:id/apply-cart-edit — per-item anchor semantics (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("anchor 'now' lands the new line at ~NOW()", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSaleWithFutureEndsAt();
    const before = Date.now();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Add a fresh package",
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
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    const newLine = await db.query<{ started_at: Date }>(
      `SELECT started_at FROM accounts.transaction_line_items WHERE id = $1`,
      [body.added_line_item_ids[0]],
    );
    const startedAtMs = new Date(newLine.rows[0].started_at).getTime();
    expect(startedAtMs).toBeGreaterThanOrEqual(before - 2000);
    expect(startedAtMs).toBeLessThanOrEqual(Date.now() + 2000);
  });

  it("anchor { chain_from_line_id } lands the new line at the source's ends_at", async () => {
    if (!ready) return;
    const { transactionId, groupId, lineId, endsAt } = await seedSaleWithFutureEndsAt();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Extend the booking",
      additions: [
        {
          customer_group_id: groupId,
          items: [
            {
              package_variant_id: variantAId,
              quantity: 1,
              anchor: { chain_from_line_id: lineId },
            },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    const newLine = await db.query<{ started_at: Date }>(
      `SELECT started_at FROM accounts.transaction_line_items WHERE id = $1`,
      [body.added_line_item_ids[0]],
    );
    expect(new Date(newLine.rows[0].started_at).getTime()).toBe(new Date(endsAt).getTime());
  });

  it("rejects a chain_from_line_id pointing at a DIFFERENT transaction with 400/404 and mutates nothing", async () => {
    if (!ready) return;
    const { transactionId, groupId } = await seedSaleWithFutureEndsAt();
    const other = await seedSaleWithFutureEndsAt();

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Attempt cross-transaction chaining",
      additions: [
        {
          customer_group_id: groupId,
          items: [
            {
              package_variant_id: variantAId,
              quantity: 1,
              anchor: { chain_from_line_id: other.lineId },
            },
          ],
        },
      ],
    });
    expect([400, 404]).toContain(res.status);

    const linesAfter = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM accounts.transaction_line_items WHERE transaction_id = $1`,
      [transactionId],
    );
    expect(linesAfter.rows[0].n).toBe("1");
  });
});
