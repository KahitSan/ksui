import { test, expect, type APIRequestContext } from "@playwright/test";

// Regression coverage for the ReferenceError crash when fetching transaction
// detail or outstanding. The bug: routes.ts called findPackagesByIds,
// findVariantsByIds, and findClientsByIds without importing them from
// lib/peers.ts, causing ReferenceError at runtime on any transaction whose
// line items reference a package/variant/client.
//
// API-only — creates its own fixture transaction via POST /charge so it
// passes in both CI (no pre-seeded data) and the worktree.

const EMAIL = process.env.E2E_EMAIL || "admin@kahitsan.com";
const PASSWORD = process.env.E2E_PASSWORD || "password";

async function signIn(api: APIRequestContext): Promise<number> {
  const res = await api.post("/api/auth/sign-in/email", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(200);

  const orgsRes = await api.get("/api/organizations");
  expect(orgsRes.status()).toBe(200);
  const orgsBody = await orgsRes.json();
  const orgs = orgsBody.data ?? orgsBody;
  expect(Array.isArray(orgs)).toBe(true);
  expect(orgs.length).toBeGreaterThan(0);
  return orgs[0].id as number;
}

test.describe("GET /api/transactions/:id — cross-plugin peer resolution", () => {
  test("returns 200 with enriched line items", async ({ request }) => {
    const orgId = await signIn(request);

    // Create a fixture transaction via POST /charge with manual line items.
    // destination_account_id is a soft reference (stored as-is, no FK), so
    // any positive integer works even if no financial-accounts rows exist.
    const chargeRes = await request.post("/api/transactions/charge", {
      headers: { "X-Organization-Id": String(orgId) },
      data: {
        destination_account_id: 1,
        items: [
          { description: "e2e test item", quantity: 1, unit_price: 100 },
        ],
      },
    });
    expect(chargeRes.status(), await chargeRes.text()).toBe(201);
    const chargeBody = await chargeRes.json();
    const txnId = chargeBody.transaction?.id;
    expect(txnId).toBeTruthy();

    // Fetch the full detail — this is where the bug lived: the handler
    // called findPackagesByIds/findVariantsByIds/findClientsByIds without
    // importing them, crashing on any transaction with line items.
    const detailRes = await request.get(`/api/transactions/${txnId}`, {
      headers: { "X-Organization-Id": String(orgId) },
    });
    expect(detailRes.status(), `detail failed: ${await detailRes.text()}`).toBe(200);
    const detail = await detailRes.json();

    expect(detail).toHaveProperty("line_items");
    expect(Array.isArray(detail.line_items)).toBe(true);
    expect(detail.line_items.length).toBeGreaterThan(0);
    expect(detail).toHaveProperty("payments");
    expect(detail).toHaveProperty("attachments");
    expect(detail).toHaveProperty("edits");
    expect(detail).toHaveProperty("client_pool");

    // Line item shape should have peer-resolved name fields.
    for (const li of detail.line_items) {
      expect(li).toHaveProperty("package_name");
      expect(li).toHaveProperty("variant_name");
      expect(li).toHaveProperty("client_name");
    }
  });

  test("returns 200 for outstanding route", async ({ request }) => {
    const orgId = await signIn(request);

    const res = await request.get("/api/transactions/outstanding", {
      headers: { "X-Organization-Id": String(orgId) },
    });
    expect(res.status(), `outstanding failed: ${await res.text()}`).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// Regression coverage for the payee-not-persisted and updated_by-always-Unknown
// bugs. Create and update a manual transaction through the full lifecycle, then
// verify the enrichments on detail, list, and update response.
test.describe("payee and updated_by enrichment", () => {
  const today = new Date().toISOString().slice(0, 10);

  test("saves payee_id on create and enriches detail with payee + updated_by_name", async ({ request }) => {
    const orgId = await signIn(request);

    const createRes = await request.post("/api/transactions", {
      headers: { "X-Organization-Id": String(orgId) },
      data: {
        category: "expense",
        amount: 500,
        description: `e2e-payee-updatedby-${Date.now()}`,
        transaction_date: today,
        source_account_id: 1,
        payee_id: 99,
        backdate_reason: "e2e test",
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const created = await createRes.json();
    expect(created.payee_id).toBe(99);

    const detailRes = await request.get(`/api/transactions/${created.id}`, {
      headers: { "X-Organization-Id": String(orgId) },
    });
    expect(detailRes.status(), await detailRes.text()).toBe(200);
    const detail = await detailRes.json();

    expect(detail).toHaveProperty("payee_id", 99);
    expect(detail).toHaveProperty("payee");
    expect(detail).toHaveProperty("updated_by");
    expect(detail).toHaveProperty("updated_by_name");
    expect(detail.updated_by).toBeTruthy();
    expect(detail.updated_by_name).toBeTruthy();
    expect(typeof detail.updated_by_name).toBe("string");
    expect(detail.updated_by_name).not.toBe("Unknown");
    expect(detail).toHaveProperty("created_by_name");
    expect(typeof detail.created_by_name).toBe("string");
    expect(detail.created_by_name).not.toBe("Unknown");
  });

  test("update resolves updated_by_name in PUT response and in subsequent detail", async ({ request }) => {
    const orgId = await signIn(request);

    const createRes = await request.post("/api/transactions", {
      headers: { "X-Organization-Id": String(orgId) },
      data: {
        category: "expense",
        amount: 250,
        description: `e2e-update-updatedby-${Date.now()}`,
        transaction_date: today,
        source_account_id: 1,
        backdate_reason: "e2e test",
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const created = await createRes.json();

    const putRes = await request.put(`/api/transactions/${created.id}`, {
      headers: { "X-Organization-Id": String(orgId) },
      data: { description: `${created.description} (edited)`, reason: "e2e test" },
    });
    expect(putRes.status(), await putRes.text()).toBe(200);
    const updated = await putRes.json();
    expect(updated).toHaveProperty("updated_by_name");
    expect(updated.updated_by_name).toBeTruthy();
    expect(typeof updated.updated_by_name).toBe("string");
    expect(updated.updated_by_name).not.toBe("Unknown");

    const detailRes = await request.get(`/api/transactions/${created.id}`, {
      headers: { "X-Organization-Id": String(orgId) },
    });
    expect(detailRes.status(), await detailRes.text()).toBe(200);
    const detail = await detailRes.json();
    expect(detail.updated_by_name).toBeTruthy();
    expect(detail.updated_by_name).not.toBe("Unknown");
  });

  test("list returns payee and updated_by_name per row", async ({ request }) => {
    const orgId = await signIn(request);

    const createRes = await request.post("/api/transactions", {
      headers: { "X-Organization-Id": String(orgId) },
      data: {
        category: "expense",
        amount: 100,
        description: `e2e-list-enrich-${Date.now()}`,
        transaction_date: today,
        source_account_id: 1,
        backdate_reason: "e2e test",
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const created = await createRes.json();

    const listRes = await request.get("/api/transactions", {
      headers: { "X-Organization-Id": String(orgId) },
      params: { limit: "50", page: "1" },
    });
    expect(listRes.status(), await listRes.text()).toBe(200);
    const body = await listRes.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);

    const match = body.data.find((t: any) => t.id === created.id);
    expect(match).toBeTruthy();
    expect(match).toHaveProperty("payee");
    expect(match).toHaveProperty("updated_by_name");
    expect(match.updated_by_name).toBeTruthy();
    expect(match.updated_by_name).not.toBe("Unknown");
  });
});
