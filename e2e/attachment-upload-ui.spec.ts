import { test, expect } from "@playwright/test";

// UI behavior: uploading an attachment in the transaction detail modal shows an
// optimistic tile while the upload is in flight and then the real attachment
// appears in the gallery WITHOUT a page reload or reopening the modal.
//
// Regression guard for the bug where the detail component captured props.txn
// once (const t = props.txn), so the post-upload state update didn't re-render
// the attachment gallery — the user had to refresh to see the new file.

const EMAIL = process.env.E2E_EMAIL || "admin@kahitsan.com";
const PASSWORD = process.env.E2E_PASSWORD || "password";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  const emailInput = page.getByRole("textbox", { name: /email/i });
  await expect(emailInput).toBeVisible({ timeout: 15_000 });
  await emailInput.fill(EMAIL);
  await page.getByRole("textbox", { name: /password/i }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

test("uploaded attachment appears in the detail gallery without a reload", async ({ page }) => {
  await login(page);
  await page.goto("/transactions");
  await expect(
    page.getByTestId("page-shell-header").getByRole("heading", { name: "Transactions" }),
  ).toBeVisible();

  // Record an expense to attach to.
  const desc = `e2e-attach-${Date.now()}`;
  await page.getByTestId("transactions-add-btn").click();
  await expect(page.getByTestId("transactions-create-modal")).toBeVisible();
  await page.getByTestId("transactions-form-category-expense").click();
  await page.getByTestId("transactions-form-amount").fill("42.00");
  await page.getByTestId("transactions-form-description").fill(desc);
  await page.getByTestId("transactions-form-submit").click();
  await expect(page.getByTestId("transactions-create-modal")).toHaveCount(0);

  // Open its detail.
  await page.getByText(desc, { exact: true }).first().click();
  const modal = page.getByTestId("transactions-detail-modal");
  await expect(modal).toBeVisible();

  // Pin the modal element handle so we can prove it was never re-mounted (a
  // reload or modal reopen would replace it). If the gallery only updated
  // because the page reloaded, this handle would go stale.
  const modalHandle = await modal.elementHandle();

  // Upload straight onto the hidden file input (the visible button opens a
  // native chooser the test runner can't drive).
  const fileInput = modal.locator('input[type="file"][accept*="pdf"]');
  await fileInput.setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: PNG_BYTES,
  });

  // The committed attachment image appears in the gallery, served from object
  // storage — no reload, no reopen.
  const galleryImg = modal.locator('img[src*="/uploads/transactions/"]');
  await expect(galleryImg.first()).toBeVisible({ timeout: 15_000 });

  // Same DOM node the whole time → the gallery updated in place, not via reload.
  const sameModal = await page.evaluate(
    ([node]) => node === document.querySelector('[data-testid="transactions-detail-modal"]'),
    [modalHandle],
  );
  expect(sameModal).toBe(true);

  // Best-effort cleanup so repeated local runs don't pile attachments (CI uses
  // a fresh per-run DB, so this is not needed for isolation).
  try {
    await page.getByRole("button", { name: "Remove attachment" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click({ timeout: 3_000 });
  } catch {
    /* non-fatal */
  }
});
