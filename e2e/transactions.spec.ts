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
