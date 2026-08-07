import { describe, expect, it } from "vitest";
import {
  computeVoucherDiscount,
  toNumberOrZero,
} from "../../server/lib/voucher-discount.js";

// The voucher discount math is ported verbatim from the monolith and must
// mirror the client-side preview exactly — if these assertions drift the
// displayed breakdown and the persisted charge disagree. This is the only
// place the amounts are pinned directly; the integration suites
// (extend-voucher, charge-overage-voucher, cart-reduction-voucher) only assert
// end-to-end numbers.

describe("toNumberOrZero", () => {
  it("coerces null/undefined to 0", () => {
    expect(toNumberOrZero(null)).toBe(0);
    expect(toNumberOrZero(undefined)).toBe(0);
  });

  it("parses pg-numeric strings (NUMERIC columns serialize to strings)", () => {
    expect(toNumberOrZero("150.00")).toBe(150);
    expect(toNumberOrZero("0.50")).toBe(0.5);
    expect(toNumberOrZero(150)).toBe(150);
  });

  it("coerces malformed values to 0 so they can't poison the math", () => {
    expect(toNumberOrZero("abc")).toBe(0);
    expect(toNumberOrZero(NaN)).toBe(0);
    expect(toNumberOrZero(Infinity)).toBe(0);
    expect(toNumberOrZero("Infinity")).toBe(0);
  });
});

describe("computeVoucherDiscount", () => {
  it("returns zero discount for a non-positive subtotal regardless of voucher", () => {
    expect(computeVoucherDiscount(0, { type: "free", value: null })).toEqual({
      discountAmount: 0,
      discountedTotal: 0,
    });
    expect(computeVoucherDiscount(-100, { type: "free", value: null })).toEqual({
      discountAmount: 0,
      discountedTotal: 0,
    });
  });

  it("free voucher discounts the entire subtotal", () => {
    expect(computeVoucherDiscount(500, { type: "free", value: null })).toEqual({
      discountAmount: 500,
      discountedTotal: 0,
    });
  });

  it("fixed_amount is capped at the subtotal (never more than owed)", () => {
    // 200 off a 500 subtotal.
    expect(
      computeVoucherDiscount(500, { type: "fixed_amount", value: "200" }),
    ).toEqual({ discountAmount: 200, discountedTotal: 300 });
    // A fixed amount larger than the subtotal only discounts the subtotal.
    expect(
      computeVoucherDiscount(500, { type: "fixed_amount", value: "900" }),
    ).toEqual({ discountAmount: 500, discountedTotal: 0 });
  });

  it("percentage discounts round to cents and respect max_discount_amount", () => {
    // 10% of 500 = 50.
    expect(
      computeVoucherDiscount(500, {
        type: "percentage",
        value: "10",
        max_discount_amount: null,
      }),
    ).toEqual({ discountAmount: 50, discountedTotal: 450 });
    // 10% of 500 = 50, but capped at 30.
    expect(
      computeVoucherDiscount(500, {
        type: "percentage",
        value: "10",
        max_discount_amount: "30",
      }),
    ).toEqual({ discountAmount: 30, discountedTotal: 470 });
  });

  it("percentage discount is also capped at the subtotal", () => {
    expect(
      computeVoucherDiscount(500, {
        type: "percentage",
        value: "120",
        max_discount_amount: null,
      }),
    ).toEqual({ discountAmount: 500, discountedTotal: 0 });
  });

  it("clamps a negative discount to 0", () => {
    // A fixed_amount is min(value, subtotal) so it can never be negative, but
    // the guard still protects the percentage path against a weird cap/value.
    expect(
      computeVoucherDiscount(500, {
        type: "percentage",
        value: "-5",
        max_discount_amount: null,
      }),
    ).toEqual({ discountAmount: 0, discountedTotal: 500 });
  });
});