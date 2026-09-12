import { describe, expect, it, vi } from "vitest";
import {
  addCivilDays,
  addCivilMonths,
  buildMonthCalendarDays,
  civilWeekday,
  formatCivilDate,
  parseCivilDate,
  requireCivilDate,
  todayInTimeZone,
} from "./month-calendar-date";

describe("month calendar civil dates", () => {
  it("parses valid dates and rejects rollover dates", () => {
    expect(parseCivilDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseCivilDate("2023-02-29")).toBeNull();
    expect(parseCivilDate("2024-2-09")).toBeNull();
    expect(() => requireCivilDate("2024-13-01")).toThrow(TypeError);
  });

  it("uses UTC arithmetic across leap days and years", () => {
    expect(formatCivilDate(addCivilDays({ year: 2024, month: 2, day: 28 }, 1))).toBe("2024-02-29");
    expect(formatCivilDate(addCivilDays({ year: 2024, month: 12, day: 31 }, 1))).toBe("2025-01-01");
    expect(addCivilMonths({ year: 2025, month: 1, day: 31 }, -1)).toEqual({ year: 2024, month: 12, day: 1 });
    expect(civilWeekday({ year: 2026, month: 9, day: 12 })).toBe(6);
  });

  it("builds a stable six-week grid for any week start", () => {
    const sunday = buildMonthCalendarDays("2026-09-20", "2026-09-12", 0);
    expect(sunday).toHaveLength(42);
    expect(sunday[0].date).toBe("2026-08-30");
    expect(sunday[41].date).toBe("2026-10-10");
    expect(sunday.find((day) => day.isToday)?.date).toBe("2026-09-12");

    const monday = buildMonthCalendarDays("2026-09-01", "2026-09-12", 1);
    expect(monday[0].date).toBe("2026-08-31");
    expect(monday[6].date).toBe("2026-09-06");
  });

  it("rejects invalid weekStartsOn values", () => {
    expect(() => buildMonthCalendarDays("2026-09-01", "2026-09-12", 7)).toThrow(RangeError);
  });

  it("derives today in the requested time zone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T00:30:00Z"));
    expect(todayInTimeZone("America/Los_Angeles")).toEqual({ year: 2026, month: 9, day: 11 });
    expect(todayInTimeZone("Asia/Manila")).toEqual({ year: 2026, month: 9, day: 12 });
    vi.useRealTimers();
  });
});
