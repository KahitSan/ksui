import { describe, expect, it } from "vitest";
import { formatActiveLineLabel, summarizeActiveLines } from "../../server/lib/active-line-summary.js";

// Pure label/rollup logic shared by the list route's LATERAL, apply-cart-
// edit's regenerate step, and the detail route (see active-line-summary.ts
// header) — tested directly here rather than only through the slower
// real-Postgres integration suite (transactions-list-summary-after-cart-
// edit.test.ts), which still covers the same contract end-to-end.

describe("formatActiveLineLabel", () => {
  it("prepends the resolved package name to a bare description exactly once", () => {
    expect(formatActiveLineLabel("4 Hours", "Entrance Area")).toBe("Entrance Area — 4 Hours");
  });

  it("uses an em dash (U+2014) with a single space on each side, not a hyphen", () => {
    const label = formatActiveLineLabel("4 Hours", "Entrance Area");
    expect(label).toBe("Entrance Area — 4 Hours");
    expect(label).not.toContain(" - ");
  });

  it("passes a charge-format description through untouched instead of doubling the prefix", () => {
    const alreadyPrefixed = "Entrance Area — 4 Hours";
    expect(formatActiveLineLabel(alreadyPrefixed, "Entrance Area")).toBe(alreadyPrefixed);
  });

  it("does not false-positive on a description merely starting with a similar-looking name", () => {
    // "Entrance" is a prefix of "Entrance Area" but the em-dash-guard checks
    // the FULL resolved name, so this must still get prepended, not treated
    // as already-labeled.
    expect(formatActiveLineLabel("Entrance — extra text", "Entrance Area")).toBe(
      "Entrance Area — Entrance — extra text",
    );
  });

  it("falls back to the bare description when the package name is null (unresolved/missing package)", () => {
    expect(formatActiveLineLabel("4 Hours", null)).toBe("4 Hours");
  });
});

describe("summarizeActiveLines", () => {
  it("joins N× label pairs with a comma-space, preserving input order", () => {
    const summary = summarizeActiveLines([
      { quantity: 2, description: "4 Hours", package_name: "Entrance Area" },
      { quantity: 1, description: "Inner Area", package_name: "Cart Edit Test Package" },
    ]);
    expect(summary).toBe("2× Entrance Area — 4 Hours, 1× Cart Edit Test Package — Inner Area");
  });

  it("labels each line via formatActiveLineLabel, including the null-package fallback", () => {
    const summary = summarizeActiveLines([
      { quantity: 1, description: "Manual Add-on", package_name: null },
    ]);
    expect(summary).toBe("1× Manual Add-on");
  });

  it("returns an empty string for an empty line list rather than throwing", () => {
    // Production callers guard on `lines.length > 0` before calling this
    // (transactions-core.ts / transactions-detail.ts) so a caller sees a
    // stored-description fallback instead — but the function itself is total.
    expect(summarizeActiveLines([])).toBe("");
  });
});
