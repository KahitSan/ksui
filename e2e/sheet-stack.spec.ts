import { test, expect } from "@playwright/test";

// A sheet Modal listens for Escape on window. A dialog Modal or confirm()
// opened over it must take that Escape alone, so the sheet (and any form it
// holds) survives.

test.describe("dialog stacked over a sheet Modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("sheet-open").click();
    await expect(page.getByTestId("sheet-content")).toBeVisible();
    await page.getByTestId("sheet-input").fill("draft");
  });

  test("Escape closes only the stacked dialog, then the sheet", async ({ page }) => {
    await page.getByTestId("sheet-inner-open").click();
    await expect(page.getByTestId("sheet-inner-content")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sheet-inner-content")).toHaveCount(0);
    await expect(page.getByTestId("sheet-content")).toBeVisible();
    await expect(page.getByTestId("sheet-input")).toHaveValue("draft");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sheet-content")).toHaveCount(0);
  });

  test("Escape on confirm() resolves false and keeps the sheet", async ({ page }) => {
    await page.getByTestId("sheet-confirm-open").click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
    await expect(page.getByTestId("sheet-confirm-answer")).toHaveText("false");
    await expect(page.getByTestId("sheet-content")).toBeVisible();
    await expect(page.getByTestId("sheet-input")).toHaveValue("draft");
  });
});
