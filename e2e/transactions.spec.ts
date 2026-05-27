import { test, expect } from "@playwright/test";

// End-to-end coverage for the transactions plugin against a kserp host that
// loaded it STANDALONE (no peer plugins). Proves the core slice works on its
// own: the page renders, a manual expense can be created and appears in the
// list, its detail opens, and it can be voided (soft-deleted) so it leaves the
// active list and reappears under the "voided" filter. The POS charge + voucher
// + package RPC path is exercised in the with-peers verification, not here.

const EMAIL = process.env.E2E_EMAIL || "admin@kahitsan.com";
const PASSWORD = process.env.E2E_PASSWORD || "password";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
  await page.getByRole("textbox", { name: /password/i }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

test("create, view, and void a manual expense", async ({ page }) => {
  await login(page);

  await page.goto("/transactions");
  await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();

  // --- Create a manual expense ---
  const desc = `e2e-expense-${Date.now()}`;
  await page.getByTestId("transactions-add-btn").click();
  await expect(page.getByTestId("transactions-create-modal")).toBeVisible();
  await page.getByTestId("transactions-form-category").selectOption("expense");
  await page.getByTestId("transactions-form-amount").fill("1234.56");
  await page.getByTestId("transactions-form-description").fill(desc);
  await page.getByTestId("transactions-form-submit").click();

  // The create modal closes and the new transaction shows up in the list.
  await expect(page.getByTestId("transactions-create-modal")).toHaveCount(0);
  const listRow = page.getByRole("button", { name: desc, exact: true });
  await expect(listRow).toBeVisible();

  // --- Open detail ---
  await listRow.click();
  await expect(page.getByTestId("transactions-detail-modal")).toBeVisible();
  await expect(page.getByRole("heading", { name: desc })).toBeVisible();

  // --- Void (soft-delete) ---
  await page.getByTestId("transactions-void-btn").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Void" }).click();

  // The detail modal closes and the transaction leaves the (default active) list.
  await expect(page.getByTestId("transactions-detail-modal")).toHaveCount(0);
  await expect(page.getByRole("button", { name: desc, exact: true })).toHaveCount(0);

  // It reappears under the "voided" filter, confirming the soft delete.
  await page.getByRole("button", { name: "voided", exact: true }).click();
  await expect(page.getByRole("button", { name: desc, exact: true })).toBeVisible();
});

test("manage subcategories", async ({ page }) => {
  await login(page);
  await page.goto("/transactions");
  await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();

  await page.getByTestId("transactions-subcat-btn").click();
  await expect(page.getByTestId("transactions-subcat-modal")).toBeVisible();

  const name = `e2e-cat-${Date.now()}`;
  await page.getByTestId("transactions-subcat-name").fill(name);
  await page.getByTestId("transactions-subcat-add").click();

  await expect(page.getByText(name, { exact: true })).toBeVisible();
});
