import { test, expect } from "@playwright/test";

// DatePicker e2e: real browser rendering of the calendar popover, day
// selection, and the PHT date contract. jsdom can't validate the Portal
// positioning or the real DOM click → onChange flow. The dedup rule:
// plugin UI tests must NOT re-assert "calendar opens on click" or
// "selecting a day calls onChange" — those are owned here.

test.describe("DatePicker", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders trigger with placeholder when no value is selected", async ({ page }) => {
    await expect(page.getByText("Pick date")).toBeVisible();
  });

  test("opens calendar popover on trigger click", async ({ page }) => {
    await page.getByText("Pick date").click();
    // Calendar grid appears with day-of-week headers — scope to the popover
    // to avoid matching the "ksui e2e" heading which also contains "Su".
    const popover = page.getByTestId("datepicker-popover");
    await expect(popover.getByText("Su", { exact: true })).toBeVisible();
    await expect(popover.getByText("Mo", { exact: true })).toBeVisible();
  });

  test("selects a day and updates the trigger label", async ({ page }) => {
    // Open the popover
    await page.getByText("Pick date").click();
    // Click day 15 in the current month grid
    const day15 = page.locator("button").filter({ hasText: /^15$/ }).first();
    await day15.click();
    // Trigger should now show the selected date (not "Pick date")
    await expect(page.getByText("Pick date")).not.toBeVisible();
    // The value display should show something (date format varies by month)
    await expect(page.getByTestId("datepicker-value")).not.toHaveText("none");
  });
});
