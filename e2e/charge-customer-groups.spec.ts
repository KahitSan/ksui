import { test, expect, type APIRequestContext } from "@playwright/test";

// Regression coverage for the multi-customer POST /api/transactions/charge
// path. The bug this guards: when the counter UI rang up two or more
// customers on one receipt (per-cg started_at, no top-level started_at), the
// server's legacy validator rejected the payload with "transaction_date and
// started_at must be provided together" and the charge never posted.
//
// API-only — the counter UI lives in kplugin_counter and is not loaded by
// this plugin's standalone host. Driving the request directly against the
// charge endpoint is enough to catch a regression in the validator or the
// multi-customer writer.

const EMAIL = process.env.E2E_EMAIL || "admin@kahitsan.com";
const PASSWORD = process.env.E2E_PASSWORD || "password";

interface Ctx {
  orgId: number;
  accountId: number;
  client1Id: number;
  client2Id: number;
}

// `destination_account_id` and `client_id` are SOFT references in this plugin:
// the columns are plain INTEGERs with no FK (the financial_accounts and
// clients rows live in OTHER plugins' schemas and aren't guaranteed to be
// loaded). The plugin intentionally does not enforce the existence of those
// rows at charge time — peer-plugin org checks are the producer plugins'
// responsibility. That contract lets the standalone CI host (which loads ONLY
// this plugin) charge using arbitrary positive integers as account / client
// ids without provisioning real rows. The spec leans on that property so it
// has zero coupling to peer plugins it doesn't need to test.
const FAKE_ACCOUNT_ID = 99_001;
const FAKE_CLIENT_1_ID = 99_101;
const FAKE_CLIENT_2_ID = 99_102;

async function signIn(api: APIRequestContext): Promise<number> {
  // Better Auth sign-in lands a session cookie on the request context.
  const res = await api.post("/api/auth/sign-in/email", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(200);

  // Discover an organization the seeded admin can act on. The CI host seeds
  // a superuser but no organization_members rows; the orgs endpoint still
  // returns the orgs the migration created.
  const orgsRes = await api.get("/api/organizations");
  expect(orgsRes.status()).toBe(200);
  const orgsBody = await orgsRes.json();
  const orgs = orgsBody.data ?? orgsBody;
  expect(Array.isArray(orgs)).toBe(true);
  expect(orgs.length).toBeGreaterThan(0);
  return orgs[0].id as number;
}

async function signInAndProvision(api: APIRequestContext): Promise<Ctx> {
  const orgId = await signIn(api);
  return {
    orgId,
    accountId: FAKE_ACCOUNT_ID,
    client1Id: FAKE_CLIENT_1_ID,
    client2Id: FAKE_CLIENT_2_ID,
  };
}

function manualLine(label: string) {
  return {
    description: label,
    quantity: 1,
    unit_price: 99,
    duration_value: 4,
    duration_unit: "hour" as const,
  };
}

test.describe("POST /api/transactions/charge — multi-customer breakdown", () => {
  test("accepts customer_groups with per-cg started_at and persists the breakdown", async ({
    request,
  }) => {
    const { orgId, accountId, client1Id, client2Id } = await signInAndProvision(request);
    const startedAt = "2026-05-28T23:45:00.000Z";

    const res = await request.post("/api/transactions/charge", {
      headers: { "x-organization-id": String(orgId), "content-type": "application/json" },
      data: {
        destination_account_id: accountId,
        client_id: client1Id,
        client_ids: [client1Id, client2Id],
        items: [manualLine("cg1 line"), manualLine("cg2 line")],
        customer_groups: [
          {
            client_id: client1Id,
            display_name: "Customer 1",
            note: null,
            voucher_id: null,
            is_payer: true,
            item_indices: [0],
            started_at: startedAt,
          },
          {
            client_id: client2Id,
            display_name: "Customer 2",
            note: null,
            voucher_id: null,
            is_payer: false,
            item_indices: [1],
            started_at: startedAt,
          },
        ],
        transaction_date: "2026-05-29",
        amount_collected: 198,
      },
    });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body.transaction).toBeTruthy();
    expect(body.transaction.id).toBeTruthy();
    // Parent transaction reflects the payer's client and the supplied date.
    expect(body.transaction.client_id).toBe(client1Id);
    // batch_code is assigned for 2+ customers so staff can recognize the
    // shared booking — null here would mean the multi-customer path didn't
    // actually run.
    expect(body.transaction.batch_code).not.toBeNull();
    // Two line items, both anchored to the cg's started_at.
    expect(body.line_items).toHaveLength(2);
    for (const li of body.line_items) {
      expect(new Date(li.started_at).toISOString()).toBe(startedAt);
      // ends_at = started_at + 4 hours = 2026-05-29T03:45:00Z
      expect(new Date(li.ends_at).toISOString()).toBe("2026-05-29T03:45:00.000Z");
    }
    // Each line item is attributed to its own customer group (not parent's).
    expect(body.line_items[0].customer_group_id).not.toBeNull();
    expect(body.line_items[1].customer_group_id).not.toBeNull();
    expect(body.line_items[0].customer_group_id).not.toBe(body.line_items[1].customer_group_id);
    expect(body.line_items[0].client_id).toBe(client1Id);
    expect(body.line_items[1].client_id).toBe(client2Id);
  });

  test("rejects top-level started_at when customer_groups is present", async ({ request }) => {
    const { orgId, accountId, client1Id, client2Id } = await signInAndProvision(request);
    const res = await request.post("/api/transactions/charge", {
      headers: { "x-organization-id": String(orgId), "content-type": "application/json" },
      data: {
        destination_account_id: accountId,
        client_id: client1Id,
        items: [manualLine("a"), manualLine("b")],
        customer_groups: [
          {
            client_id: client1Id,
            display_name: "A",
            is_payer: true,
            item_indices: [0],
            started_at: "2026-05-28T23:45:00.000Z",
          },
          {
            client_id: client2Id,
            display_name: "B",
            is_payer: false,
            item_indices: [1],
            started_at: "2026-05-28T23:45:00.000Z",
          },
        ],
        // The forbidden combination.
        transaction_date: "2026-05-29",
        started_at: "2026-05-28T23:45:00.000Z",
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/started_at is not allowed at the top level/);
  });

  test("rejects customer_groups with two payers", async ({ request }) => {
    const { orgId, accountId, client1Id, client2Id } = await signInAndProvision(request);
    const res = await request.post("/api/transactions/charge", {
      headers: { "x-organization-id": String(orgId), "content-type": "application/json" },
      data: {
        destination_account_id: accountId,
        items: [manualLine("a"), manualLine("b")],
        customer_groups: [
          { client_id: client1Id, display_name: "A", is_payer: true, item_indices: [0] },
          { client_id: client2Id, display_name: "B", is_payer: true, item_indices: [1] },
        ],
        transaction_date: "2026-05-29",
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/exactly one .*is_payer=true/);
  });

  test("rejects customer_groups whose item_indices do not partition items", async ({
    request,
  }) => {
    const { orgId, accountId, client1Id } = await signInAndProvision(request);
    const res = await request.post("/api/transactions/charge", {
      headers: { "x-organization-id": String(orgId), "content-type": "application/json" },
      data: {
        destination_account_id: accountId,
        items: [manualLine("a"), manualLine("b")],
        // Only one group claiming index 0 — item 1 is unclaimed.
        customer_groups: [
          { client_id: client1Id, display_name: "A", is_payer: true, item_indices: [0] },
        ],
        transaction_date: "2026-05-29",
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(
      /every item must be claimed by exactly one customer group/,
    );
  });

  test("accepts a per-group voucher_id and degrades gracefully when it doesn't resolve", async ({
    request,
  }) => {
    // findById now backs per-group vouchers, but an id with no matching voucher
    // row (here a bogus 99) must not block the charge: it degrades like the
    // top-level voucher_code path — full subtotal, no discount, 201.
    const { orgId, accountId, client1Id, client2Id } = await signInAndProvision(request);
    const res = await request.post("/api/transactions/charge", {
      headers: { "x-organization-id": String(orgId), "content-type": "application/json" },
      data: {
        destination_account_id: accountId,
        items: [manualLine("a"), manualLine("b")],
        customer_groups: [
          {
            client_id: client1Id,
            display_name: "A",
            is_payer: true,
            item_indices: [0],
            voucher_id: 99,
          },
          { client_id: client2Id, display_name: "B", is_payer: false, item_indices: [1] },
        ],
        transaction_date: "2026-05-29",
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    // No discount applied — the bogus voucher resolved to nothing.
    expect(Number(body.transaction.discount_amount)).toBe(0);
    expect(Number(body.transaction.amount)).toBe(198); // 2 × ₱99, full subtotal
  });

  test("applies a per-group voucher discount when the voucher resolves", async ({ request }) => {
    // vouchers is co-mounted in this plugin's CI (ciCoMounts). Create a real
    // ₱50 fixed-amount voucher, attach it to one customer group, and assert the
    // server resolved it via findById, computed the discount against that
    // group's subtotal, and folded it into the parent transaction's total.
    const { orgId, accountId, client1Id, client2Id } = await signInAndProvision(request);

    const voucherRes = await request.post("/api/vouchers", {
      headers: { "x-organization-id": String(orgId), "content-type": "application/json" },
      // Omit `code` so the server mints a unique one (no cross-retry 23505).
      data: { type: "fixed_amount", value: 50 },
    });
    expect(voucherRes.status(), await voucherRes.text()).toBe(201);
    const voucherId = (await voucherRes.json()).id as number;
    expect(voucherId).toBeTruthy();

    const res = await request.post("/api/transactions/charge", {
      headers: { "x-organization-id": String(orgId), "content-type": "application/json" },
      data: {
        destination_account_id: accountId,
        client_id: client1Id,
        client_ids: [client1Id, client2Id],
        items: [manualLine("voucher line"), manualLine("plain line")],
        customer_groups: [
          {
            client_id: client1Id,
            display_name: "A",
            is_payer: true,
            item_indices: [0],
            voucher_id: voucherId,
          },
          { client_id: client2Id, display_name: "B", is_payer: false, item_indices: [1] },
        ],
        transaction_date: "2026-05-29",
        amount_collected: 148,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    // Group A's ₱99 subtotal less the ₱50 fixed voucher = ₱50 discount on the
    // parent; group B is undiscounted. Total = 198 − 50 = 148.
    expect(Number(body.transaction.discount_amount)).toBe(50);
    expect(Number(body.transaction.amount)).toBe(148);
  });
});
