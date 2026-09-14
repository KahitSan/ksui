import { expect, test } from "@playwright/test";

const themes = [
  { name: "dark", tokens: { "--ks-surface": "#0f0f0f", "--ks-surface-raised": "#1a1a1a", "--ks-fg": "#ffffff", "--ks-fg-muted": "#a1a1aa", "--ks-border": "rgba(39,39,42,0.5)", "--ks-accent": "#fbbf24" } },
  { name: "light", tokens: { "--ks-surface": "#ffffff", "--ks-surface-raised": "#f4f4f5", "--ks-fg": "#18181b", "--ks-fg-muted": "#52525b", "--ks-border": "rgba(161,161,170,0.5)", "--ks-accent": "#785a00" } },
] as const;

for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  for (const theme of themes) {
    test(`${viewport.name} ${theme.name}: shared variants render and remain operable`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.evaluate((tokens) => {
        for (const [name, value] of Object.entries(tokens)) document.documentElement.style.setProperty(name, value);
      }, theme.tokens);

      const section = page.getByTestId("shared-blockers-section");
      await expect(section.getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
      await section.getByRole("button", { name: "Tue" }).click();
      await expect(section.getByRole("button", { name: "Tue" })).toHaveAttribute("aria-pressed", "true");
      await expect(section.getByRole("progressbar", { name: "2 / 5 paid" })).toHaveAttribute("aria-valuenow", "40");
      await section.getByRole("radio", { name: "Calendar" }).click();
      await expect(section.getByRole("radio", { name: "Calendar" })).toHaveAttribute("aria-checked", "true");
      await page.getByTestId("shared-action-menu").click();
      await page.getByRole("menuitem", { name: "Open" }).click();
      await expect(page.getByTestId("selected-action")).toHaveText("open");

      await page.getByTestId("modal-header-open").click();
      await expect(page.getByRole("heading", { name: "Edit schedule" })).toBeVisible();
      await expect(page.getByText("Future entries only")).toBeVisible();
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("heading", { name: "Edit schedule" })).not.toBeVisible();
    });
  }
}
