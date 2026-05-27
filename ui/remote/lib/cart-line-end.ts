// Helpers behind the "ends …" preview on Counter cart lines.
//
// `addInterval` mirrors PostgreSQL's `make_interval` math, which is what the
// server uses to stamp `transaction_line_items.ends_at` at charge time.
// Hours and days are additive in both languages, so JS's setHours/setDate
// match PG one-to-one. Months are the trap: PG clamps March 31 + 1 month
// to April 30, but `Date.prototype.setMonth` overflows to May 1 because
// April 31 is not a real date. The setDate(0) call after setMonth rolls
// back to the last day of the previous month, which after the overflow
// is the last day of the *target* month — matching the server.
//
// `lineEndDate` exists so split-per-unit lines (which the server inserts as
// separate quantity-1 line items, each ending at start + duration) skip the
// quantity multiplier; bulk lines roll forward by duration * quantity.

export type DurationUnit = "hour" | "day" | "month";

export interface EndTimeLineInput {
  duration_value: number;
  duration_unit: DurationUnit;
  quantity: number;
  // Defined when the cart line is in split-per-unit mode. Length must equal
  // quantity. The cart only reads `.length` from this in lineEndDate, so any
  // truthy array is enough.
  clientPerUnit?: unknown[];
}

export function addInterval(start: Date, value: number, unit: DurationUnit): Date {
  const d = new Date(start.getTime());
  if (unit === "hour") d.setHours(d.getHours() + value);
  else if (unit === "day") d.setDate(d.getDate() + value);
  else {
    const day = d.getDate();
    d.setMonth(d.getMonth() + value);
    if (d.getDate() !== day) d.setDate(0);
  }
  return d;
}

export function lineEndDate(line: EndTimeLineInput, start: Date): Date {
  const isSplit = !!line.clientPerUnit;
  const total = line.duration_value * (isSplit ? 1 : line.quantity);
  return addInterval(start, total, line.duration_unit);
}

export function formatLineEnd(end: Date, start: Date): string {
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const time = new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(end);
  if (sameDay) return time;
  const date = new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(end);
  return `${date} · ${time}`;
}

// Renders a "start to end" window for cart lines and customer cards in
// the availment modal. Replaces the previous "<raw ISO> → <end>" form
// — the ISO start was unreadable for cashiers. When start + end fall
// on the same calendar day we render the date once and pair both
// times ("May 21, 8:00 AM to 11:31 PM"); when end crosses into the
// next day we surface both dates ("May 21, 10:31 PM to Fri, May 22 ·
// 8:31 AM"), making "+1d" markers redundant.
export function formatTimeWindow(timeInIso: string | null | undefined, end: Date | null): string {
  if (!timeInIso) return "";
  const start = new Date(timeInIso);
  if (Number.isNaN(start.getTime())) return timeInIso;
  const sameDay =
    end != null &&
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const datePart = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
  }).format(start);
  const startTime = new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(start);
  if (!end) return `${datePart}, ${startTime}`;
  if (sameDay) {
    const endTime = new Intl.DateTimeFormat("en-PH", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(end);
    return `${datePart}, ${startTime} to ${endTime}`;
  }
  const endDate = new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(end);
  const endTime = new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(end);
  return `${datePart}, ${startTime} to ${endDate} · ${endTime}`;
}
