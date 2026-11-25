import { expect, test } from "@playwright/test";
import contract from "../scripts/icon-artwork-contract.json" with { type: "json" };

test("owned icons render with their native SVG and lookup contracts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?icons");
  await expect(
    page.getByRole("heading", { name: "Original icons" })
  ).toBeVisible();
  const names = [...new Set([...contract.runtime.map((item) => item.name), ...contract.requiredSourceNames])];
  await expect(page.locator("[data-icon-name]")).toHaveCount(names.length);
  const failedPaint = await page.locator("[data-icon-name]").evaluateAll(async (cells) => {
    const failures: string[] = [];
    for (const cell of cells) {
      const original = cell.querySelector("svg");
      if (!original || original.getAttribute("aria-hidden") !== "true") {
        failures.push(cell.getAttribute("data-icon-name") ?? "missing SVG");
        continue;
      }
      const svg = original.cloneNode(true) as SVGSVGElement;
      svg.setAttribute("color", getComputedStyle(original).color);
      // SVG-as-image cannot load external subresources. Fetch the real emitted
      // URL first, then embed its bytes for this independent decode/paint check.
      for (const image of svg.querySelectorAll("image")) {
        const href = image.getAttribute("href")!;
        if (href.startsWith("data:")) continue;
        const response = await fetch(href);
        if (!response.ok) throw new Error(`Artwork request failed: ${response.status} ${href}`);
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        image.setAttribute("href", dataUrl);
      }
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 24;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, 24, 24);
        const rgba = context.getImageData(0, 0, 24, 24).data;
        if (!rgba.some((value, index) => index % 4 === 3 && value > 16)) failures.push(cell.getAttribute("data-icon-name")!);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    return failures;
  });
  expect(failedPaint).toEqual([]);
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
