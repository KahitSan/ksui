// Tax-ID helpers shared by the transaction form and its hosts, so both sides
// apply the same rule before a TIN is saved.

const TIN_PATTERN = /^\d{9}(\d{3})?$/;

/** Trims the input and drops dashes and spaces: "123-456-789" -> "123456789". */
export function normalizeTin(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/** A TIN is 9 digits, or 12 with the branch code. Blank is valid (optional). */
export function isValidTin(value: string): boolean {
  const digits = normalizeTin(value);
  return digits === "" || TIN_PATTERN.test(digits);
}
