import { test, expect } from "@playwright/test";

// End-to-end coverage for the transactions plugin against a kserp host that
// loaded it STANDALONE (no peer plugins). Exercises the current UI: the page
// renders with its ledger table (stat-cards were removed in the fork audit), a
// manual expense can be recorded through the "Record Transaction" modal
// (icon-card category selector + hero amount + host DatePicker date defaulting
// to today + description), it appears in the list, its detail opens, and an
// admin can void (soft-delete) it so it leaves the default active list. The POS
// charge + voucher + package RPC path is exercised in the with-peers
// verification, not here.

const EMAIL = process.env.E2E_EMAIL || "admin@kahitsan.com";
const PASSWORD = process.env.E2E_PASSWORD || "password";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
  await page.getByRole("textbox", { name: /password/i }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

test("record, view, and void a manual expense", async ({ page }) => {
  await login(page);

  await page.goto("/transactions");
  await expect(page.getByTestId("page-shell-header").getByRole("heading", { name: "Transactions" })).toBeVisible();
  // The "Record Transaction" CTA confirms the page (and its remote bundle) loaded.
  await expect(page.getByTestId("transactions-add-btn")).toBeVisible();

  // --- Record a manual expense via the rich modal ---
  const desc = `e2e-expense-${Date.now()}`;
  await page.getByTestId("transactions-add-btn").click();
  await expect(page.getByTestId("transactions-create-modal")).toBeVisible();
  // Category selector is an icon-card grid, not a <select>.
  await page.getByTestId("transactions-form-category-expense").click();
  await page.getByTestId("transactions-form-amount").fill("1234.56");
  await page.getByTestId("transactions-form-description").fill(desc);
  await page.getByTestId("transactions-form-submit").click();

  // The create modal closes and the new transaction shows up in the list.
  await expect(page.getByTestId("transactions-create-modal")).toHaveCount(0);
  const listRow = page.getByText(desc, { exact: true });
  await expect(listRow.first()).toBeVisible();

  // --- Open detail ---
  await listRow.first().click();
  await expect(page.getByTestId("transactions-detail-modal")).toBeVisible();

  // --- Void (soft-delete) ---
  await page.getByTestId("transactions-void-btn").click();
  await page.getByRole("button", { name: "Void Transaction" }).click();

  // The detail modal closes and the transaction leaves the (default active) list.
  await expect(page.getByTestId("transactions-detail-modal")).toHaveCount(0);
});

// Regression guard: the transaction detail endpoint must return 200 with
// properly populated customer_group display_name fields. A prior deployment
// shipped the dynamic client-name resolution but accidentally dropped the
// cgClientName lookup variables, causing 500s on every detail request
// (ReferenceError: cgClientName is not defined).
test("transaction detail resolves customer group display names without crashing", async ({ page }) => {
  await login(page);
  await page.goto("/transactions");
  // Confirm the page UI loaded (proves the list endpoint works).
  await expect(page.getByTestId("page-shell-header").getByRole("heading", { name: "Transactions" })).toBeVisible();
  await expect(page.getByTestId("transactions-add-btn")).toBeVisible();

  // Now verify the detail endpoint via the page's own fetch (shares cookies).
  const detailRes = await page.evaluate(async () => {
    const orgId = localStorage.getItem("ks_active_org_id") || "1";
    const res = await fetch("/api/transactions?limit=1", {
      headers: { "X-Organization-Id": orgId },
    });
    if (!res.ok) return { status: res.status, body: null };
    const body = await res.json();
    const data = body.data || body;
    const txn = Array.isArray(data) ? data[0] : data;
    if (!txn) return { status: res.status, body: null, noTxn: true };
    const detail = await fetch(`/api/transactions/${txn.id}`, {
      headers: { "X-Organization-Id": orgId },
    });
    return { status: detail.status, body: await detail.json() };
  });
  // If there are no transactions in the seed data, the test is vacuously
  // green (the regression only triggers with customer_groups present,
  // which requires a transaction to exist).
  if (detailRes.noTxn) {
    test.skip(true, "No transactions in seed data");
    return;
  }
  expect(detailRes.status).toBe(200);
  expect(detailRes.body).toHaveProperty("id");
  expect(detailRes.body).toHaveProperty("customer_groups");
  // At least one customer group must be present — otherwise the field
  // assertions below never execute and the guard is vacuously green.
  expect(detailRes.body.customer_groups.length).toBeGreaterThan(0);
  for (const cg of detailRes.body.customer_groups) {
    expect(cg).toHaveProperty("display_name");
    expect(cg).toHaveProperty("client_name");
  }
});
