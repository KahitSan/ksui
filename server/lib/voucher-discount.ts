// Pure server-side voucher discount math. Ported verbatim from the monolith
// transactions plugin (kplugins/transactions/server/lib/voucher-discount.ts).
// Mirrors the client-side discount preview so the displayed breakdown always
// agrees with what the charge route persists.

export interface VoucherForDiscount {
  type: "percentage" | "fixed_amount" | "free";
  value: string | number | null;
  max_discount_amount?: string | number | null;
}

// Coerces pg-numeric string values (NUMERIC columns serialize to strings) to
// number. NaN and non-finite results coerce to 0 so a malformed value can't
// propagate into the discount math.
export function toNumberOrZero(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export function computeVoucherDiscount(
  subtotal: number,
  voucher: VoucherForDiscount,
): { discountAmount: number; discountedTotal: number } {
  if (subtotal <= 0) {
    return { discountAmount: 0, discountedTotal: Math.max(0, subtotal) };
  }
  let discountAmount = 0;
  if (voucher.type === "free") {
    discountAmount = subtotal;
  } else if (voucher.type === "fixed_amount") {
    discountAmount = Math.min(toNumberOrZero(voucher.value), subtotal);
  } else if (voucher.type === "percentage") {
    const raw = Math.round((subtotal * toNumberOrZero(voucher.value)) / 100);
    const cap =
      voucher.max_discount_amount != null ? toNumberOrZero(voucher.max_discount_amount) : raw;
    discountAmount = Math.min(raw, cap, subtotal);
  }
  if (discountAmount < 0) discountAmount = 0;
  return { discountAmount, discountedTotal: Math.max(0, subtotal - discountAmount) };
}
