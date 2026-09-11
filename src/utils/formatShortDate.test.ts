import { describe, expect, it } from "vitest";
import { formatShortDate } from "./formatShortDate";

describe("formatShortDate", () => {
  it("preserves date-only values across runtime timezone defaults", () => {
    expect(formatShortDate("2026-09-10")).toBe("Sep 10, 2026");
  });

  it("uses the date component from full ISO values", () => {
    expect(formatShortDate("2026-09-10T00:00:00.000Z")).toBe("Sep 10, 2026");
  });

  it("returns a placeholder for missing or malformed values", () => {
    expect(formatShortDate(null)).toBe("—");
    expect(formatShortDate("not-a-date")).toBe("—");
  });
});
