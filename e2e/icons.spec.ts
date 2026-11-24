import { expect, test } from "@playwright/test";

test("owned icons render with their native SVG and lookup contracts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?icons");
  await expect(
    page.getByRole("heading", { name: "Original icons" })
  ).toBeVisible();
  await expect(page.locator("[data-icon-name]")).toHaveCount(166);
  const painted = await page.locator("[data-icon-name]").evaluateAll((cells) =>
    cells.every((cell) => {
      const svg = cell.querySelector("svg");
      const image = svg?.querySelector("image");
      return (
        svg?.getAttribute("aria-hidden") === "true" &&
        (image?.getAttribute("href")?.startsWith("data:image/png;base64,") ||
          Boolean(svg?.querySelector("path")?.getAttribute("d")))
      );
    })
  );
  expect(painted).toBe(true);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("main")).toHaveClass("dark");
  await page.getByRole("button", { name: "Toggle star fill" }).click();
  await expect(page.getByRole("img", { name: "Preferred" })).toHaveAttribute(
    "fill",
    "currentColor"
  );
  await page.getByLabel("Icon lookup").fill("loader-2");
  await page.getByRole("button", { name: "Look up icon" }).click();
  await expect(page.locator("output")).toHaveText("loader-2");
  await page.getByLabel("Icon lookup").fill("__proto__");
  await page.getByRole("button", { name: "Look up icon" }).click();
  await expect(page.locator("output")).toHaveText("unknown");
  expect(errors).toEqual([]);
});
