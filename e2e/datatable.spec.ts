import { test, expect } from "@playwright/test";

// DataTable e2e: real browser rendering of the table grid, column headers,
// row data, and CSS injection. jsdom can't validate the injected <style>
// tag or the table's actual layout. The dedup rule: plugin UI tests must
// NOT re-assert "columns render headers" or "rows display data" — those
// are owned here.

test.describe("DataTable", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders column headers", async ({ page }) => {
    const table = page.getByTestId("datatable-section").locator("table");
    await expect(table.locator("th").nth(0)).toContainText("Name");
    await expect(table.locator("th").nth(1)).toContainText("Amount");
  });

  test("renders all data rows", async ({ page }) => {
    const table = page.getByTestId("datatable-section").locator("table");
    await expect(table.getByText("Alpha")).toBeVisible();
    await expect(table.getByText("Beta")).toBeVisible();
    await expect(table.getByText("Gamma")).toBeVisible();
  });

  test("injects the CSS style tag", async ({ page }) => {
    const style = page.locator("style#ksui-datatable-style");
    await expect(style).toBeAttached();
  });
});
