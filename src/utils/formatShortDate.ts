// Short-date formatter for plugin remotes.
//
// Renders a YYYY-MM-DD (or full ISO) date string as the en-PH short form
// (e.g. "Jan 5, 2026"). Date-only values are parsed as calendar components
// so runtime timezone defaults cannot shift their displayed day. Hilinga is an
// Asia/Manila product, so formatting uses the canonical Manila timezone.
// Returns an em-dash placeholder for a missing value. Pure helper, no DOM, no fetch.
export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const datePart = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return "—";
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
