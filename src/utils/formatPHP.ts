// Philippine peso currency formatter.
//
// Pure (.ts, no JSX): the single PHP-currency formatter every plugin had
// copy-pasted as formatCurrency / formatPHP. Parses a string or number,
// returns an em-dash placeholder on null / undefined / NaN, otherwise the
// en-PH PHP-formatted string. Zero deps beyond the platform Intl global.

export function formatPHP(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(num)) return "—";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(num);
}
