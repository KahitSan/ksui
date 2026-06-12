// Pure date/currency formatters for the transactions remote UI.
// Zero internal deps — only the platform Intl/Date globals. Extracted from
// index.tsx so both index.tsx and the later-extracted component/hook modules
// can import them without pulling in the whole screen.

export function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(num);
}

export function formatDate(dateStr: string): string {
  const datePart = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  return new Date(datePart + "T00:00:00").toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(stamp: string): string {
  const d = new Date(stamp);
  const date = d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${date} · ${time}`;
}

export function todayManila(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}
