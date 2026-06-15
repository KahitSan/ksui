// Short-date formatter for plugin remotes.
//
// Renders a YYYY-MM-DD (or full ISO) date string as the en-PH short form
// (e.g. "Jan 5, 2026"). Hilinga is an Asia/Manila product, so the date part is
// anchored at local midnight ("T00:00:00") to avoid the UTC drift that
// toISOString would introduce. Returns an em-dash placeholder for a missing
// value. Pure helper, no DOM, no fetch.

export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const datePart = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  return new Date(datePart + "T00:00:00").toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
