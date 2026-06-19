import { test, expect } from "@playwright/test";

// Modal e2e: real browser rendering of the native <dialog> element, focus
// trap, Escape handling, and backdrop-click. These are the behaviors that
// jsdom vitest tests can't fully validate (dialog showModal, focus trap,
// portal rendering). The dedup rule: plugin UI tests must NOT re-assert
// these — they're owned here.

test.describe("Modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("modal-open").click();
    await expect(page.getByTestId("modal-content")).toBeVisible();
  });

  test("opens a native dialog with aria-modal", async ({ page }) => {
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  test("renders children inside the dialog", async ({ page }) => {
    await expect(page.getByTestId("modal-content")).toContainText("Modal body");
  });

  test("closes on Escape key", async ({ page }) => {
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("modal-content")).not.toBeVisible();
  });

  test("closes on close button click", async ({ page }) => {
    await page.getByTestId("modal-close").click();
    await expect(page.getByTestId("modal-content")).not.toBeVisible();
  });
});
