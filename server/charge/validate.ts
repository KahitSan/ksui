// Charge payload types + pure validators for the isolated transactions plugin.
//
// Extracted VERBATIM from helpers-charge.ts on the existing function seams:
// the charge type surface (ChargeLineInput / ChargeCustomerGroup /
// ChargePayload / ChargeResult), the ChargeValidationError class, the
// unit/date constants, and the three pure validators (validateLineItems,
// validateChargePayload, validateCustomerGroups). No SQL, no logic, no
// signature changes. The original public surface is re-exported from the
// helpers-charge.ts barrel so callers keep importing from there.
//
// unit_price's upper bound (below) is a later addition, not part of the
// verbatim extraction — it feeds accounts.transaction_line_items.unit_price
// NUMERIC(12,2) directly, so an unbounded value 22003-errors into a 500
// instead of a clean 400.

import { MAX_NUMERIC_12_2 } from "../routes/shared.js";

export interface ChargeLineInput {
  // package_id / package_variant_id are OPTIONAL here (unlike the monolith,
  // which always carried a package ref). A line with neither is a "manual"
  // line item that works even when the packages plugin is off.
  package_id?: number | null;
  package_variant_id?: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  duration_value?: number | null;
  duration_unit?: "hour" | "day" | "month" | null;
  client_id?: number | null;
}

// Multi-customer POS breakdown. A "customer group" is one customer in a shared
// receipt: their own client (or walk-in), their own note, their own optional
// voucher, and one or more line items attributed to them. One group has
// is_payer=true; the receipt is issued in their name and the single payment
// leg lands on the parent transaction. The parent transaction remains 1:1 with
// the cashier-rung receipt so accounting stays clean.
//
// `item_indices` references positions in the parent ChargePayload.items array.
// Every index in 0..items.length-1 must appear in exactly one group (the
// validator enforces a clean partition).
export interface ChargeCustomerGroup {
  client_id?: number | null;
  display_name: string;
  note?: string | null;
  // Per-group voucher. The new POS attaches a voucher per customer and sends
  // its id here; the charge route resolves it via the vouchers `findById` RPC
  // and computes the discount against this group's subtotal (see chargeFlow's
  // per-customer-group block). The resolved discount lands on the group row
  // and sums into the parent transaction's discount/total.
  voucher_id?: number | null;
  is_payer: boolean;
  item_indices: number[];
  // Per-customer-group booking anchor. When supplied, every line item in
  // this group uses this ISO timestamp as started_at (and ends_at is
  // computed from started_at + duration). When omitted/null, the group's
  // lines anchor to NOW() at insert time. Under the customer_groups contract
  // this is the ONLY way to anchor lines: top-level `started_at` is rejected
  // so two customers on the same receipt can have different start times.
  started_at?: string | null;
}

export interface ChargePayload {
  destination_account_id: number;
  client_id?: number | null;
  client_ids?: number[] | null;
  // Either voucher_code (resolved over RPC) or no voucher. The monolith keyed
  // on voucher_id; the vouchers RPC validates by CODE, so the isolated charge
  // accepts a code.
  voucher_code?: string | null;
  discount_amount?: number;
  items: ChargeLineInput[];
  transaction_date?: string;
  started_at?: string;
  backdate_reason?: string | null;
  notes?: string | null;
  amount_collected?: number | null;
  parent_transaction_id?: number | null;
  // Multi-customer breakdown. When present, the parent transaction's
  // client_id is taken from the payer group, per-line client_id falls back to
  // the group's client_id (not the parent's, which doesn't apply to non-payer
  // lines), and per-line started_at comes from each group's own `started_at`.
  // Top-level `started_at` is rejected when this field is present.
  customer_groups?: ChargeCustomerGroup[];
}

export interface ChargeResult {
  transaction: Record<string, unknown>;
  line_items: Array<Record<string, unknown>>;
  voucher_applied: { code: string; discount: number } | null;
  packages_available: boolean;
  vouchers_available: boolean;
}

export const VALID_UNITS = ["hour", "day", "month"] as const;
export type ValidUnit = (typeof VALID_UNITS)[number];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ChargeValidationError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ChargeValidationError";
  }
}

// Pure validator for the items[] array. Same shape rules as the monolith,
// except package refs are optional (a manual line item is allowed).
export function validateLineItems(items: unknown): asserts items is ChargeLineInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ChargeValidationError(400, "items must be a non-empty array");
  }
  for (const [idx, line] of items.entries()) {
    if (!line || typeof line !== "object") {
      throw new ChargeValidationError(400, `items[${idx}] must be an object`);
    }
    const l = line as Record<string, unknown>;
    if (typeof l.description !== "string" || !l.description.trim()) {
      throw new ChargeValidationError(400, `items[${idx}] missing description`);
    }
    if (typeof l.quantity !== "number" || !Number.isFinite(l.quantity) || l.quantity <= 0) {
      throw new ChargeValidationError(400, `items[${idx}].quantity must be > 0`);
    }
    if (typeof l.unit_price !== "number" || !Number.isFinite(l.unit_price) || l.unit_price < 0) {
      throw new ChargeValidationError(400, `items[${idx}].unit_price must be >= 0`);
    }
    if (l.unit_price > MAX_NUMERIC_12_2) {
      throw new ChargeValidationError(
        400,
        `items[${idx}].unit_price must not exceed ${MAX_NUMERIC_12_2}`,
      );
    }
    // A package ref requires BOTH package_id and package_variant_id together,
    // or NEITHER (manual line). Half a ref is a malformed cart.
    const hasPkg = l.package_id != null;
    const hasVariant = l.package_variant_id != null;
    if (hasPkg !== hasVariant) {
      throw new ChargeValidationError(
        400,
        `items[${idx}] must carry both package_id and package_variant_id, or neither`,
      );
    }
    if (hasPkg) {
      if (typeof l.package_id !== "number" || !Number.isFinite(l.package_id) || l.package_id <= 0) {
        throw new ChargeValidationError(400, `items[${idx}].package_id must be a positive integer`);
      }
      if (
        typeof l.package_variant_id !== "number" ||
        !Number.isFinite(l.package_variant_id) ||
        l.package_variant_id <= 0
      ) {
        throw new ChargeValidationError(
          400,
          `items[${idx}].package_variant_id must be a positive integer`,
        );
      }
    }
    if (l.duration_unit != null) {
      if (
        typeof l.duration_unit !== "string" ||
        !(VALID_UNITS as readonly string[]).includes(l.duration_unit)
      ) {
        throw new ChargeValidationError(
          400,
          `items[${idx}].duration_unit must be one of: ${VALID_UNITS.join(", ")}`,
        );
      }
      if (
        typeof l.duration_value !== "number" ||
        !Number.isFinite(l.duration_value) ||
        l.duration_value <= 0
      ) {
        throw new ChargeValidationError(
          400,
          `items[${idx}].duration_value must be > 0 when duration_unit is set`,
        );
      }
    }
    if (l.client_id != null) {
      if (typeof l.client_id !== "number" || !Number.isFinite(l.client_id) || l.client_id <= 0) {
        throw new ChargeValidationError(400, `items[${idx}].client_id must be a positive integer`);
      }
    }
  }
}

export function validateChargePayload(payload: ChargePayload): void {
  if (typeof payload.destination_account_id !== "number" || payload.destination_account_id <= 0) {
    throw new ChargeValidationError(400, "destination_account_id is required");
  }
  validateLineItems(payload.items);
  // Legacy single-customer path: transaction_date and started_at are paired
  // (either both as a custom start or neither, defaulting to NOW() /
  // CURRENT_DATE). Mixed input would let the calendar entry drift from the
  // line items' anchor.
  //
  // Multi-customer path (customer_groups present): top-level started_at is
  // forbidden. Each customer_groups entry carries its own optional started_at
  // so two customers on the same receipt can have different start times.
  // transaction_date stays top-level (it's the parent transaction's calendar
  // date, one per receipt); when absent the parent defaults to CURRENT_DATE.
  const hasDate = payload.transaction_date != null;
  const hasTs = payload.started_at != null;
  const hasGroups = payload.customer_groups != null;
  if (hasGroups && hasTs) {
    throw new ChargeValidationError(
      400,
      "started_at is not allowed at the top level when customer_groups is present (use customer_groups[].started_at instead)",
    );
  }
  if (!hasGroups && hasDate !== hasTs) {
    throw new ChargeValidationError(
      400,
      "transaction_date and started_at must be provided together",
    );
  }
  if (hasDate) {
    if (
      typeof payload.transaction_date !== "string" ||
      !ISO_DATE_RE.test(payload.transaction_date)
    ) {
      throw new ChargeValidationError(400, "transaction_date must be YYYY-MM-DD");
    }
  }
  if (hasTs) {
    if (typeof payload.started_at !== "string" || Number.isNaN(Date.parse(payload.started_at))) {
      throw new ChargeValidationError(400, "started_at must be a valid ISO timestamp");
    }
  }
  if (payload.amount_collected != null) {
    if (
      typeof payload.amount_collected !== "number" ||
      !Number.isFinite(payload.amount_collected) ||
      payload.amount_collected < 0
    ) {
      throw new ChargeValidationError(400, "amount_collected must be a non-negative number");
    }
  }
  if (payload.voucher_code != null && typeof payload.voucher_code !== "string") {
    throw new ChargeValidationError(400, "voucher_code must be a string");
  }
  if (payload.customer_groups != null) {
    validateCustomerGroups(payload.customer_groups, payload.items.length);
  }
}

// Multi-customer breakdown invariants. Enforces:
//   - non-empty array of objects
//   - exactly one is_payer=true
//   - display_name is a non-empty string
//   - client_id is a positive integer when present
//   - voucher_id, when present, is a positive integer (resolved + discounted
//     server-side via the vouchers findById RPC)
//   - started_at is a valid ISO timestamp when present
//   - item_indices partition exactly [0..itemsLength-1] across all groups
export function validateCustomerGroups(
  groups: unknown,
  itemsLength: number,
): asserts groups is ChargeCustomerGroup[] {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new ChargeValidationError(400, "customer_groups must be a non-empty array");
  }
  let payerCount = 0;
  const claimedIndices = new Set<number>();
  for (const [gIdx, raw] of groups.entries()) {
    if (!raw || typeof raw !== "object") {
      throw new ChargeValidationError(400, `customer_groups[${gIdx}] must be an object`);
    }
    const g = raw as Record<string, unknown>;
    if (typeof g.display_name !== "string" || !g.display_name.trim()) {
      throw new ChargeValidationError(400, `customer_groups[${gIdx}].display_name is required`);
    }
    if (g.client_id != null) {
      if (typeof g.client_id !== "number" || !Number.isFinite(g.client_id) || g.client_id <= 0) {
        throw new ChargeValidationError(
          400,
          `customer_groups[${gIdx}].client_id must be a positive integer`,
        );
      }
    }
    if (g.note != null && typeof g.note !== "string") {
      throw new ChargeValidationError(400, `customer_groups[${gIdx}].note must be a string`);
    }
    if (g.voucher_id != null) {
      // Per-group voucher: the charge route resolves it via the vouchers
      // `findById` RPC and computes the discount against this group's
      // subtotal. Only shape-validate here.
      if (typeof g.voucher_id !== "number" || !Number.isInteger(g.voucher_id) || g.voucher_id <= 0) {
        throw new ChargeValidationError(
          400,
          `customer_groups[${gIdx}].voucher_id must be a positive integer`,
        );
      }
    }
    if (typeof g.is_payer !== "boolean") {
      throw new ChargeValidationError(400, `customer_groups[${gIdx}].is_payer must be a boolean`);
    }
    if (g.is_payer) payerCount++;
    if (g.started_at != null) {
      if (typeof g.started_at !== "string" || Number.isNaN(Date.parse(g.started_at))) {
        throw new ChargeValidationError(
          400,
          `customer_groups[${gIdx}].started_at must be a valid ISO timestamp`,
        );
      }
    }
    if (!Array.isArray(g.item_indices) || g.item_indices.length === 0) {
      throw new ChargeValidationError(
        400,
        `customer_groups[${gIdx}].item_indices must be a non-empty array`,
      );
    }
    for (const idx of g.item_indices) {
      if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= itemsLength) {
        throw new ChargeValidationError(
          400,
          `customer_groups[${gIdx}].item_indices must be integers in [0, items.length)`,
        );
      }
      if (claimedIndices.has(idx)) {
        throw new ChargeValidationError(
          400,
          `items[${idx}] is claimed by more than one customer group`,
        );
      }
      claimedIndices.add(idx);
    }
  }
  if (payerCount !== 1) {
    throw new ChargeValidationError(
      400,
      "exactly one customer_groups entry must have is_payer=true",
    );
  }
  if (claimedIndices.size !== itemsLength) {
    throw new ChargeValidationError(
      400,
      "every item must be claimed by exactly one customer group",
    );
  }
}
