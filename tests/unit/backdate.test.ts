import { describe, expect, it } from "vitest";
import { isBackdated, todayInOrgTimezone } from "../../server/lib/backdate.js";

// The backdate gate anchors "today" to Asia/Manila regardless of the host's
// system timezone. The CI runner's TZ is UTC, so any logic that read the
// process local date would drift 8 hours; these tests pin a UTC instant and
// assert the PHT frame — the same discipline the prod gate relies on.

describe("todayInOrgTimezone", () => {
  it("anchors to Asia/Manila (UTC+8), ignoring the host system timezone", () => {
    // 2026-06-20T16:00:00Z is midnight on 2026-06-21 in Manila.
    expect(todayInOrgTimezone(new Date("2026-06-20T16:00:00Z"))).toBe("2026-06-21");
    // 2026-06-20T15:59:00Z is still 2026-06-20 23:59 in Manila.
    expect(todayInOrgTimezone(new Date("2026-06-20T15:59:00Z"))).toBe("2026-06-20");
    // Midnight UTC is 08:00 the same calendar day in Manila.
    expect(todayInOrgTimezone(new Date("2026-06-20T00:00:00Z"))).toBe("2026-06-20");
  });

  it("emits a YYYY-MM-DD string that sorts and compares lexicographically", () => {
    const s = todayInOrgTimezone(new Date("2026-01-09T00:00:00Z"));
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // zero-padded month/day (en-CA locale guarantees this)
    expect(s).toBe("2026-01-09");
  });
});

describe("isBackdated", () => {
  // Pin "now" to 2026-06-20T16:00:00Z ⇒ Manila "today" is 2026-06-21.
  const now = new Date("2026-06-20T16:00:00Z");

  it("is false for the Manila today", () => {
    expect(isBackdated("2026-06-21", now)).toBe(false);
  });

  it("is true for the UTC calendar day when it is already tomorrow in Manila", () => {
    // 2026-06-20 is yesterday in the Manila frame of `now`.
    expect(isBackdated("2026-06-20", now)).toBe(true);
  });

  it("is true for a future-dated entry (audit posture treats future as backdated)", () => {
    expect(isBackdated("2026-06-22", now)).toBe(true);
  });

  it("matches the e2e contract: a date equal to today is NOT backdated (no permission needed)", () => {
    // The create handler only demands transactions.backdate + a reason when
    // isBackdated is true; using today must skip that gate.
    expect(isBackdated(todayInOrgTimezone(now), now)).toBe(false);
  });
});
