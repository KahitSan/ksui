export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export interface MonthCalendarDay extends CivilDate {
  date: string;
  inMonth: boolean;
  isToday: boolean;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function formatCivilDate(date: CivilDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function parseCivilDate(value: string): CivilDate | null {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const stamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(stamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function requireCivilDate(value: string, name = "date"): CivilDate {
  const parsed = parseCivilDate(value);
  if (!parsed) throw new TypeError(`${name} must be a valid YYYY-MM-DD date`);
  return parsed;
}

export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

export function addCivilMonths(date: CivilDate, months: number): CivilDate {
  const monthIndex = date.year * 12 + date.month - 1 + months;
  return {
    year: Math.floor(monthIndex / 12),
    month: ((monthIndex % 12) + 12) % 12 + 1,
    day: 1,
  };
}

export function civilWeekday(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function todayInTimeZone(timeZone: string): CivilDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
  };
}

export function buildMonthCalendarDays(
  monthAnchor: string,
  today: string,
  weekStartsOn = 0,
): MonthCalendarDay[] {
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
    throw new RangeError("weekStartsOn must be an integer from 0 through 6");
  }
  const month = requireCivilDate(monthAnchor, "month");
  const current = { year: month.year, month: month.month, day: 1 };
  const todayDate = requireCivilDate(today, "today");
  const todayKey = formatCivilDate(todayDate);
  const leadingDays = (civilWeekday(current) - weekStartsOn + 7) % 7;
  const first = addCivilDays(current, -leadingDays);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addCivilDays(first, index);
    const key = formatCivilDate(date);
    return {
      ...date,
      date: key,
      inMonth: date.year === current.year && date.month === current.month,
      isToday: key === todayKey,
    };
  });
}
