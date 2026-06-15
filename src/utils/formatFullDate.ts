// Canonical date+time formatter for the en-PH locale.
//
// Pure helper, no rendering and no domain coupling. Renders a parsed timestamp
// as "Mon D, YYYY · h:mm AM" using the platform Intl/Date globals. Returns the
// em-dash placeholder on a null or empty input so render sites can drop it
// straight into a cell without a guard.

export function formatFullDate(stamp: string | null | undefined): string {
  if (!stamp) return "—";
  const d = new Date(stamp);
  const date = d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${date} · ${time}`;
}
