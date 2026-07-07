import { describe, expect, it } from "vitest";
import { manilaToday, ymd } from "../../ui/remote/analytics-shared.js";

// The folded-in Analytics date-preset math anchors "today" to Asia/Manila
// regardless of the host's system timezone. The CI runner's TZ is UTC, so the
// former `new Date().toISOString().slice(0,10)` read the UTC day and drifted the
// preset window by one calendar day during PHT early morning. These tests pin a
// UTC instant and assert the PHT frame — the same discipline backdate.test.ts uses.

describe("manilaToday", () => {
  it("anchors to the Manila civil date (UTC+8), ignoring the host timezone", () => {
    // 2026-06-20T16:00:00Z is already 2026-06-21 00:00 in Manila.
    expect(ymd(manilaToday(new Date("2026-06-20T16:00:00Z")))).toBe("2026-06-21");
    // 2026-06-20T15:59:00Z is still 2026-06-20 23:59 in Manila.
    expect(ymd(manilaToday(new Date("2026-06-20T15:59:00Z")))).toBe("2026-06-20");
    // Early PHT morning (00:00–08:00) is where a bare toISOString() reports
    // yesterday: 2026-07-07T00:00:00Z is 2026-07-07 08:00 in Manila, same day.
    expect(ymd(manilaToday(new Date("2026-07-07T00:00:00Z")))).toBe("2026-07-07");
  });

  it("returns a Date whose day-arithmetic stays on the Manila calendar day", () => {
    // month/week presets do getDate()/getDay()/getMonth() on this Date, so the
    // anchor must expose Manila's civil components (not the UTC instant's).
    const anchor = manilaToday(new Date("2026-06-20T16:00:00Z")); // Manila 2026-06-21
    expect(anchor.getDate()).toBe(21);
    expect(anchor.getMonth()).toBe(5); // June (0-indexed)
    expect(anchor.getFullYear()).toBe(2026);
    // The "month" preset's from = first of the Manila month.
    expect(ymd(new Date(anchor.getFullYear(), anchor.getMonth(), 1))).toBe("2026-06-01");
  });
});

describe("ymd", () => {
  it("emits zero-padded YYYY-MM-DD from a local-midnight Date (no UTC re-shift)", () => {
    expect(ymd(new Date(2026, 0, 9))).toBe("2026-01-09");
    expect(ymd(new Date(2026, 11, 31))).toBe("2026-12-31");
    expect(ymd(new Date(2026, 6, 7))).toBe("2026-07-07");
  });
});
