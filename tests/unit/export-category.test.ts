import { describe, expect, it } from "vitest";
import {
  exportCategoryCondition,
  type ExportCategory,
} from "../../server/routes/export.js";

describe("exportCategoryCondition", () => {
  it.each([
    ["all", null],
    ["sale", "t.category = 'sale'"],
    ["expense", "t.category = 'expense'"],
    ["other", "t.category NOT IN ('sale', 'expense')"],
  ] as const)("maps %s to its SQL condition", (category, expected) => {
    expect(exportCategoryCondition(category as ExportCategory)).toBe(expected);
  });

  it("does not interpolate arbitrary category values", () => {
    expect(exportCategoryCondition("sale' OR 1=1 --" as ExportCategory)).toBeNull();
  });
});
