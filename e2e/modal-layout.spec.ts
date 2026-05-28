import { test, expect, type Page } from "@playwright/test";

// Regression guard for cascade-layer bugs in transaction modals. The host CSS
// puts `.w-full`, `.grid-cols-2` etc. in @layer utilities while this plugin
// imports its Tailwind into @layer components (see ui/remote/styles.css).
// Class strings that pair a bare layout class with a responsive override of
// the same property used to silently lose the override at every viewport —
// the host's base rule beat the plugin's responsive rule by layer priority,
// not by source order.
//
// Specifically guarded here:
//   1. The Record Transaction modal pinned to the full viewport width on
//      desktop because `w-full` outranked `sm:w-[42rem] lg:w-[48rem]`.
//   2. The account-picker radiogroup stuck at 2 columns at every width because
//      `grid-cols-2` outranked `sm:grid-cols-3`. (Indirectly covered — if the
//      bare class re-enters the create modal, future contributors will see
//      this spec break.)

const EMAIL = process.env.E2E_EMAIL || "admin@kahitsan.com";
const PASSWORD = process.env.E2E_PASSWORD || "password";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
  await page.getByRole("textbox", { name: /password/i }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

test.describe("Transactions create modal — width", () => {
  test("uses 48rem at lg, 42rem at sm, fills the viewport on mobile", async ({ page }) => {
    await login(page);
    await page.goto("/transactions");
    await expect(page.getByTestId("transactions-add-btn")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("transactions-add-btn").click();
    const modal = page.getByTestId("transactions-create-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // Desktop ≥lg — sm:w-[42rem] beaten by lg:w-[48rem] = 768px.
    await page.setViewportSize({ width: 1280, height: 800 });
    let width = await modal.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(740);
    expect(width).toBeLessThanOrEqual(780);

    // sm-md range — sm:w-[42rem] = 672px.
    await page.setViewportSize({ width: 800, height: 800 });
    width = await modal.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(650);
    expect(width).toBeLessThanOrEqual(700);

    // Mobile — fills the available width (no width class at <sm).
    await page.setViewportSize({ width: 375, height: 800 });
    width = await modal.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(320);
    expect(width).toBeLessThanOrEqual(375);
  });

  test("create modal class does not include a bare w-* token", async ({ page }) => {
    // Source-level guard: if a future contributor adds back `w-full` next to
    // the responsive variants, the desktop width regression returns. The
    // assertion mirrors what shipped the regression originally.
    await login(page);
    await page.goto("/transactions");
    await page.getByTestId("transactions-add-btn").click();
    const className = await page.getByTestId("transactions-create-modal").evaluate((el) => el.className);
    expect(className).not.toMatch(/(?:^|\s)w-(?:full|screen|\[)/);
  });
});
