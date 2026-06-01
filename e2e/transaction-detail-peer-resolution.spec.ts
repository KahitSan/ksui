import { test, expect, type APIRequestContext } from "@playwright/test";

// Regression coverage for the ReferenceError crash when fetching transaction
// detail or outstanding. The bug: routes.ts called findPackagesByIds,
// findVariantsByIds, and findClientsByIds without importing them from
// lib/peers.ts, causing ReferenceError at runtime on any transaction whose
// line items reference a package/variant/client.
//
// API-only — all the cross-plugin name lookups (package_name, variant_name,
// client_name) are resolved server-side via kernel RPC, so no UI is needed
// to verify the route responds.

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

  // Pick the first org that has at least one transaction.
  for (const org of orgs) {
    const probe = await api.get("/api/transactions", {
      headers: { "X-Organization-Id": String(org.id) },
      params: { limit: "1", offset: "0" },
    });
    if (probe.status() !== 200) continue;
    const probeBody = await probe.json();
    const probeData = probeBody.data ?? probeBody;
    if (Array.isArray(probeData) && probeData.length > 0) {
      return org.id as number;
    }
  }
  throw new Error("no org with transactions found");
}

test.describe("GET /api/transactions/:id — cross-plugin peer resolution", () => {
  test("returns 200 with enriched line items (package/variant/client names)", async ({ request }) => {
    const orgId = await signIn(request);

    // Pick a transaction that has line items with package_id (triggers findPackagesByIds).
    const listRes = await request.get("/api/transactions", {
      headers: { "X-Organization-Id": String(orgId) },
      params: { limit: "50", offset: "0" },
    });
    expect(listRes.status(), `list failed: ${await listRes.text()}`).toBe(200);
    const listBody = await listRes.json();
    const txns = listBody.data ?? listBody;
    expect(Array.isArray(txns)).toBe(true);
    expect(txns.length).toBeGreaterThan(0);

    // Fetch the full detail of the most recent transaction.
    const txn = txns[0];
    const detailRes = await request.get(`/api/transactions/${txn.id}`, {
      headers: { "X-Organization-Id": String(orgId) },
    });
    expect(detailRes.status(), `detail failed: ${await detailRes.text()}`).toBe(200);
    const detail = await detailRes.json();

    // The response must include the enriched sub-objects that go through
    // the peer RPC functions (findPackagesByIds, findVariantsByIds, findClientsByIds).
    expect(detail).toHaveProperty("line_items");
    expect(Array.isArray(detail.line_items)).toBe(true);
    expect(detail).toHaveProperty("payments");
    expect(Array.isArray(detail.payments)).toBe(true);
    expect(detail).toHaveProperty("attachments");
    expect(detail).toHaveProperty("edits");
    expect(detail).toHaveProperty("client_pool");

    // Line items that have package_id should have package_name resolved.
    for (const li of detail.line_items) {
      expect(li).toHaveProperty("package_name");
      expect(li).toHaveProperty("variant_name");
      expect(li).toHaveProperty("client_name");
      if (li.package_id != null) {
        expect(li.package_name).not.toBeNull();
      }
    }
  });

  test("returns 200 for outstanding route (also uses findPackagesByIds)", async ({ request }) => {
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
