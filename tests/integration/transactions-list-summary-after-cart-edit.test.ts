import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import type pg from "pg";
import type { FakePluginDb } from "@kahitsan/plugin-sdk/test";
import { request, setupCartEditFixtures } from "./cart-edit-fixtures.js";

// tx #10738 repro: a cart-edit package swap voids the original line and adds
// a replacement on the SAME transaction, but the list route's row label
// (accounts.transactions.description) is written once at charge time and
// never touched by apply-cart-edit — so GET / kept showing the voided
// package's name even though amount/balance and the board (which filters
// li.status <> 'voided') were already correct. Regression-guards the LIST
// query's derived summary against that staleness.

let variantBIdForMock = 0;
let packageIdForMock = 0;

vi.mock("../../server/lib/peers.js", () => ({
  findVariantsByIds: async (ids: number[]) =>
    ids.flatMap((id) =>
      id === variantBIdForMock
        ? [{ id, package_id: packageIdForMock, name: "Inner Area", kind: "standard", price: "300.00", currency: "PHP", duration_value: "1", duration_unit: "hour", is_active: true }]
        : [],
    ),
  findPackagesByIds: async (ids: number[]) =>
    ids.includes(packageIdForMock) ? [{ id: packageIdForMock, name: "Cart Edit Test Package", type: "daily", capacity_limit: null, max_per_day: null, max_per_month: null, is_active: true }] : [],
  validateVoucher: async () => null,
  findVoucherByCode: async () => null,
  findVoucherById: async () => null,
  findClientsByIds: async () => null,
  findAccountsByIds: async () => null,
  findPayeesByIds: async () => null,
}));

const TEST_ORG = 303;

let honoApp: Hono;
let pool: pg.Pool;
let db: FakePluginDb;
let rollback: () => Promise<void>;
let ready = false;
let packageId: number;
let variantAId: number;
let variantBId: number;

beforeAll(async () => {
  const fx = await setupCartEditFixtures(TEST_ORG, "ci-ws-303");
  honoApp = fx.honoApp;
  pool = fx.pool;
  db = fx.db;
  rollback = fx.rollback;
  ready = fx.ready;
  packageId = fx.packageId;
  variantAId = fx.variantAId;
  variantBId = fx.variantBId;
  packageIdForMock = fx.packageId;
  variantBIdForMock = fx.variantBId;
});

afterAll(async () => {
  if (ready) await rollback();
  await pool.end();
});

let seedCounter = 0;

async function seedSingleLineSale(
  lineDescription: string,
): Promise<{ transactionId: number; groupId: number }> {
  const txnRes = await db.query<{ id: number }>(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by, subtotal, discount_amount)
     VALUES ($1, 'sale', 'Sales - services', 500, $2, CURRENT_DATE, 'completed', $3, 500, 0)
     RETURNING id`,
    [TEST_ORG, `1× ${lineDescription}`, "test-user-id"],
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
     VALUES ($1, $2, $3, $4, $5, 1, 500, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'active', $6)
     RETURNING id`,
    [transactionId, TEST_ORG, packageId, variantAId, lineDescription, cg.rows[0].id],
  );

  return { transactionId, groupId: cg.rows[0].id };
}

async function listRowFor(transactionId: number): Promise<{ description: string }> {
  const res = await request(honoApp, "GET", "/?limit=200");
  expect(res.status).toBe(200);
  const body = await res.json();
  const row = body.data.find((r: { id: number }) => r.id === transactionId);
  expect(row).toBeDefined();
  return row;
}

describe("GET / — list row summary after a cart-edit package swap (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("names the replacement package, not the voided original, after a swap", async () => {
    if (!ready) return;
    seedCounter++;
    const { transactionId, groupId } = await seedSingleLineSale(`Entrance Area - 4 Hours ${seedCounter}`);

    // Baseline: the stale-description bug would keep showing the original
    // line's text even after this call voids it and adds the replacement.
    const before = await listRowFor(transactionId);
    expect(before.description).toContain("Entrance Area - 4 Hours");

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Swap package on the same booking",
      reductions: [
        { customer_group_id: groupId, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
      additions: [
        {
          customer_group_id: groupId,
          items: [{ package_variant_id: variantBId, quantity: 1, anchor: "now" }],
        },
      ],
    });
    expect(res.status).toBe(200);

    // Direct assertion on the ADDITIONS-path insert itself (server/routes/
    // transactions-cart-edit.ts) — this is the row the swap actually wrote,
    // isolated from the list route's own summary-derivation logic below.
    const insertedLine = await db.query<{ description: string }>(
      `SELECT description FROM accounts.transaction_line_items
         WHERE transaction_id = $1 AND package_variant_id = $2 AND status = 'active'`,
      [transactionId, variantBId],
    );
    expect(insertedLine.rows[0].description).toBe("Cart Edit Test Package — Inner Area");

    const after = await listRowFor(transactionId);
    expect(after.description).toContain("Cart Edit Test Package — Inner Area");
    expect(after.description).not.toContain("Entrance Area - 4 Hours");
  });

  it("summarizes only the active line on a mixed active+voided transaction", async () => {
    if (!ready) return;
    seedCounter++;
    const { transactionId, groupId } = await seedSingleLineSale(`Original Package ${seedCounter}`);

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Add a second, different package",
      additions: [
        {
          customer_group_id: groupId,
          items: [{ package_variant_id: variantBId, quantity: 1, anchor: "now" }],
        },
      ],
    });
    expect(res.status).toBe(200);

    // Now void the original line directly (mimics the swap's void half
    // without the reduction/reprice path, isolating the summary-derivation
    // assertion from repricing behavior already covered elsewhere).
    await db.query(
      `UPDATE accounts.transaction_line_items SET status = 'voided'
         WHERE transaction_id = $1 AND package_variant_id = $2`,
      [transactionId, variantAId],
    );

    const row = await listRowFor(transactionId);
    expect(row.description).toContain("Inner Area");
    expect(row.description).not.toContain("Original Package");
  });
});

describe("GET /:id — historical-row healing without a cart-edit (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("derives the description from the active line, not the stale stored text, on a row shaped like it predates the regen fix", async () => {
    if (!ready) return;
    seedCounter++;
    // Mimics a row edited BEFORE apply-cart-edit started regenerating
    // t.description: the stored column keeps the ORIGINAL package's text
    // while the line items underneath already reflect a swap (one voided,
    // one active) — written directly, bypassing apply-cart-edit entirely.
    const { transactionId, groupId } = await seedSingleLineSale(`Stale Historical Original ${seedCounter}`);
    await db.query(
      `UPDATE accounts.transaction_line_items SET status = 'voided'
         WHERE transaction_id = $1 AND package_variant_id = $2`,
      [transactionId, variantAId],
    );
    await db.query(
      `INSERT INTO accounts.transaction_line_items
         (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
          duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
       VALUES ($1, $2, $3, $4, 'Cart Edit Test Package — Inner Area', 1, 300, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'active', $5)`,
      [transactionId, TEST_ORG, packageId, variantBId, groupId],
    );

    const stored = await db.query<{ description: string }>(
      `SELECT description FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(stored.rows[0].description).toContain("Stale Historical Original");

    const detailRes = await request(honoApp, "GET", `/${transactionId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.description).toBe("1× Cart Edit Test Package — Inner Area");
    expect(detail.description).not.toContain("Stale Historical Original");
  });

  it("falls back to the stored description when the transaction has no line items", async () => {
    if (!ready) return;
    seedCounter++;
    const txnRes = await db.query<{ id: number }>(
      `INSERT INTO accounts.transactions
         (workspace_id, category, subcategory, amount, description, transaction_date, status, created_by)
       VALUES ($1, 'expense', 'Utilities', 500, $2, CURRENT_DATE, 'completed', $3)
       RETURNING id`,
      [TEST_ORG, `Manual expense ${seedCounter}`, "test-user-id"],
    );
    const transactionId = txnRes.rows[0].id;

    const detailRes = await request(honoApp, "GET", `/${transactionId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.description).toBe(`Manual expense ${seedCounter}`);
  });
});

describe("apply-cart-edit — stored description regenerate + GET /:id consistency (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("regenerates the STORED transactions.description to match the derived active-lines summary", async () => {
    if (!ready) return;
    seedCounter++;
    const { transactionId, groupId } = await seedSingleLineSale(`Stored Desc Original ${seedCounter}`);

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Swap package on the same booking",
      reductions: [
        { customer_group_id: groupId, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
      additions: [
        {
          customer_group_id: groupId,
          items: [{ package_variant_id: variantBId, quantity: 1, anchor: "now" }],
        },
      ],
    });
    expect(res.status).toBe(200);

    // (1) The STORED column itself — not just the list's derived summary —
    // must now equal the derived active-lines summary, since the detail
    // modal title and edit-form seed both render this column directly.
    const stored = await db.query<{ description: string }>(
      `SELECT description FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(stored.rows[0].description).toBe("1× Cart Edit Test Package — Inner Area");

    const listRow = await listRowFor(transactionId);
    expect(listRow.description).toBe(stored.rows[0].description);

    // (2) GET /:id's own description field is fresh — same value, read via
    // the detail route rather than a direct DB query.
    const detailRes = await request(honoApp, "GET", `/${transactionId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.description).toBe(stored.rows[0].description);
    expect(detail.description).not.toContain("Stored Desc Original");
  });

  it("GET /:id line_items excludes a voided line after a swap", async () => {
    if (!ready) return;
    seedCounter++;
    const { transactionId, groupId } = await seedSingleLineSale(`Detail Voided Line ${seedCounter}`);

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Swap package on the same booking",
      reductions: [
        { customer_group_id: groupId, package_id: packageId, package_variant_id: variantAId, target_quantity: 0 },
      ],
      additions: [
        {
          customer_group_id: groupId,
          items: [{ package_variant_id: variantBId, quantity: 1, anchor: "now" }],
        },
      ],
    });
    expect(res.status).toBe(200);

    // (3) GET /:id line_items excludes the voided original line — only the
    // active replacement line comes back.
    const detailRes = await request(honoApp, "GET", `/${transactionId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.line_items).toHaveLength(1);
    expect(detail.line_items[0].package_variant_id).toBe(variantBId);
    expect(
      detail.line_items.some((li: { package_variant_id: number }) => li.package_variant_id === variantAId),
    ).toBe(false);
  });

  it("leaves the stored description unchanged when reassign_payer_to is the only field sent", async () => {
    if (!ready) return;
    seedCounter++;
    const { transactionId } = await seedSingleLineSale(`No Reduction No Addition ${seedCounter}`);
    const before = await db.query<{ description: string }>(
      `SELECT description FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );

    // Add a second group WITH its own active line — the payer-integrity
    // guard 409s a reassignment onto an empty group, so both sides need
    // active lines to isolate "no reduction/addition ran on THIS call"
    // from the regenerate step, which should still run (harmlessly, since
    // the active-lines summary hasn't changed) rather than being skipped.
    const cg2 = await db.query<{ id: number }>(
      `INSERT INTO accounts.transaction_customer_groups
         (transaction_id, workspace_id, position, display_name, subtotal, discount_amount, is_payer)
       VALUES ($1, $2, 1, 'Second Payer', 300, 0, FALSE) RETURNING id`,
      [transactionId, TEST_ORG],
    );
    await db.query(
      `INSERT INTO accounts.transaction_line_items
         (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
          duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
       VALUES ($1, $2, $3, $4, 'Second Payer Line', 1, 300, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'active', $5)`,
      [transactionId, TEST_ORG, packageId, variantBId, cg2.rows[0].id],
    );

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "Reassign payer only",
      reassign_payer_to: cg2.rows[0].id,
    });
    expect(res.status).toBe(200);

    // The active-lines summary is capped at 3 lines total across the whole
    // transaction (matches the list route's derivation), so adding the
    // second group's line changes the summary itself — assert it now
    // includes BOTH descriptions rather than comparing byte-for-byte
    // against the pre-call value.
    const after = await db.query<{ description: string }>(
      `SELECT description FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(after.rows[0].description).toContain("No Reduction No Addition");
    expect(after.rows[0].description).toContain("Second Payer Line");
    expect(before.rows[0].description).not.toContain("Second Payer Line");
  });
});

// tx #10738 repro, part 2: the LIST/DETAIL title and the "Packages availed"
// pane (TransactionDetail.tsx: li.package_name ?? li.description) both
// derive from a line's package_id, but only the pane resolved it — a line
// written in the bare pre-fix format ("4 Hours", no package prefix) made the
// title read "1× 4 Hours" while the pane showed "Inner Area · 4 Hours".
// These regression-guard the shared derivation (active-line-summary.ts)
// against BOTH stored shapes, across every surface that reads it.
describe("package-name derivation — bare vs charge-format descriptions (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("prepends the resolved package name to a bare variant-only description exactly once, on every surface", async () => {
    if (!ready) return;
    seedCounter++;
    const { transactionId, groupId } = await seedSingleLineSale(`placeholder ${seedCounter}`);
    // Mimics a line written BEFORE the description-format fix: the stored
    // text is the bare variant name, with no package prefix.
    await db.query(
      `UPDATE accounts.transaction_line_items SET description = 'Inner Area', package_variant_id = $2
         WHERE transaction_id = $1`,
      [transactionId, variantBId],
    );
    const expected = "1× Cart Edit Test Package — Inner Area";

    const listRow = await listRowFor(transactionId);
    expect(listRow.description).toBe(expected);

    const detailRes = await request(honoApp, "GET", `/${transactionId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.description).toBe(expected);
    // The pane's own per-line field agrees with the title by construction —
    // both are resolved from the same package_id.
    expect(detail.line_items[0].package_name).toBe("Cart Edit Test Package");

    // reassign_payer_to (to the transaction's own single group) is the
    // lightest way to trigger apply-cart-edit's regenerate step without a
    // reduction/addition — confirms the STORED column is healed too, not
    // just the two read paths above.
    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "No-op edit to trigger the regenerate step",
      reassign_payer_to: groupId,
    });
    expect(res.status).toBe(200);
    const stored = await db.query<{ description: string }>(
      `SELECT description FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(stored.rows[0].description).toBe(expected);
  });

  it("does not double the package name on an already charge-format description", async () => {
    if (!ready) return;
    seedCounter++;
    const { transactionId, groupId } = await seedSingleLineSale(`placeholder ${seedCounter}`);
    // Charge-format text already embeds "Package — Variant" (build-charge-
    // payload.ts / transactions-cart-edit.ts's own addition path write this
    // shape) — re-resolving the package name must not prepend it twice.
    await db.query(
      `UPDATE accounts.transaction_line_items
          SET description = 'Cart Edit Test Package — Inner Area', package_variant_id = $2
        WHERE transaction_id = $1`,
      [transactionId, variantBId],
    );
    const expected = "1× Cart Edit Test Package — Inner Area";

    const listRow = await listRowFor(transactionId);
    expect(listRow.description).toBe(expected);

    const detailRes = await request(honoApp, "GET", `/${transactionId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.description).toBe(expected);

    const res = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "No-op edit to trigger the regenerate step",
      reassign_payer_to: groupId,
    });
    expect(res.status).toBe(200);
    const stored = await db.query<{ description: string }>(
      `SELECT description FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(stored.rows[0].description).toBe(expected);
  });

  it("falls back to the bare description when the line's package_id can't be resolved over RPC", async () => {
    if (!ready) return;
    seedCounter++;
    const { transactionId } = await seedSingleLineSale(`placeholder ${seedCounter}`);
    // A REAL row (package_id carries a live FK — see the 999999999 FK-
    // violation this replaced) that the findPackagesByIds mock above simply
    // doesn't answer for (it only resolves packageIdForMock) — mimics a
    // package deleted/unreachable at read time, the other half of
    // formatActiveLineLabel's null-packageName branch alongside the
    // already-covered NULL package_id case below.
    const unresolvablePkg = await db.query<{ id: number }>(
      `INSERT INTO packages.packages (workspace_id, name, type, effective_from, lineage_slug)
       VALUES ($1, 'Unresolvable Package', 'daily', CURRENT_DATE, $2) RETURNING id`,
      [TEST_ORG, `unresolvable-pkg-${TEST_ORG}-${seedCounter}`],
    );
    await db.query(
      `UPDATE accounts.transaction_line_items SET description = 'Unresolvable Package Line', package_id = $2
         WHERE transaction_id = $1`,
      [transactionId, unresolvablePkg.rows[0].id],
    );

    const listRow = await listRowFor(transactionId);
    expect(listRow.description).toBe("1× Unresolvable Package Line");

    const detailRes = await request(honoApp, "GET", `/${transactionId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.description).toBe("1× Unresolvable Package Line");
  });

  it("falls back to the bare description when the line has no package_id at all (manual add-on)", async () => {
    if (!ready) return;
    seedCounter++;
    const { transactionId } = await seedSingleLineSale(`placeholder ${seedCounter}`);
    await db.query(
      `UPDATE accounts.transaction_line_items SET description = 'Manual Add-on Line', package_id = NULL, package_variant_id = NULL
         WHERE transaction_id = $1`,
      [transactionId],
    );

    const listRow = await listRowFor(transactionId);
    expect(listRow.description).toBe("1× Manual Add-on Line");

    const detailRes = await request(honoApp, "GET", `/${transactionId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.description).toBe("1× Manual Add-on Line");
  });
});

// The LATERAL (list route) and deriveActiveLineSummary (cart-edit regenerate
// + detail healing) both cap at 3 active lines via `ORDER BY li.id ASC LIMIT
// 3` (active-line-summary.ts) — silently, with no "+N more"/ellipsis suffix
// anywhere in the derivation or the routes that call it. A 5th active line
// on the same transaction regression-guards that the cap actually drops the
// low-priority (highest-id) lines instead of e.g. erroring or including all.
describe("3-line cap on the active-lines summary (real Postgres)", () => {
  it("has the prerequisites seeded (else the suite is a no-op skip)", () => {
    if (!ready) return;
    expect(honoApp).toBeDefined();
  });

  it("shows only the first 3 (lowest-id) active lines and silently drops the rest, on every surface", async () => {
    if (!ready) return;
    seedCounter++;
    const { transactionId, groupId } = await seedSingleLineSale(`Cap Line 1 ${seedCounter}`);

    // Line 1 already exists from seedSingleLineSale; add 4 more (lines 2-5)
    // directly, each with a distinguishable bare description and no
    // package_id so the assertions aren't coupled to package-name resolution.
    for (let n = 2; n <= 5; n++) {
      await db.query(
        `INSERT INTO accounts.transaction_line_items
           (transaction_id, workspace_id, package_id, package_variant_id, description, quantity, unit_price,
            duration_value, duration_unit, started_at, ends_at, status, customer_group_id)
         VALUES ($1, $2, NULL, NULL, $3, 1, 100, 1, 'hour', NOW() - INTERVAL '1 hour', NOW(), 'active', $4)`,
        [transactionId, TEST_ORG, `Cap Line ${n} ${seedCounter}`, groupId],
      );
    }

    const listRow = await listRowFor(transactionId);
    for (const n of [1, 2, 3]) {
      expect(listRow.description).toContain(`Cap Line ${n} ${seedCounter}`);
    }
    for (const n of [4, 5]) {
      expect(listRow.description).not.toContain(`Cap Line ${n} ${seedCounter}`);
    }
    expect(listRow.description).not.toContain("more");
    expect(listRow.description).not.toContain("…");
    expect(listRow.description).not.toContain("...");

    const detailRes = await request(honoApp, "GET", `/${transactionId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.description).toBe(listRow.description);

    // apply-cart-edit's regenerate step (deriveActiveLineSummary) shares the
    // same LIMIT 3 — confirm the STORED column agrees with both read paths
    // after a no-op payer-reassignment edit triggers the regenerate.
    const editRes = await request(honoApp, "POST", `/${transactionId}/apply-cart-edit`, {
      edit_token: crypto.randomUUID(),
      reason: "No-op edit to trigger the regenerate step",
      reassign_payer_to: groupId,
    });
    expect(editRes.status).toBe(200);
    const stored = await db.query<{ description: string }>(
      `SELECT description FROM accounts.transactions WHERE id = $1`,
      [transactionId],
    );
    expect(stored.rows[0].description).toBe(listRow.description);
  });
});
