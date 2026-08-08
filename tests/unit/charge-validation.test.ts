import { describe, expect, it } from "vitest";
import {
  ChargeValidationError,
  validateChargePayload,
  validateCustomerGroups,
  validateLineItems,
} from "../../server/charge/validate.js";
import { MAX_NUMERIC_12_2 } from "../../server/routes/shared.js";

// The three pure charge validators (validateLineItems / validateChargePayload /
// validateCustomerGroups) bounce a malformed request with a typed
// ChargeValidationError before any database work happens. These tests pin the
// exact status + message each shape produces so a regression in the validation
// strings can't silently change what an API client sees.

/** Asserts `fn` throws a ChargeValidationError with status 400 and the exact
 *  message. Fails loudly (not via .toThrow) so a missing throw is obvious. */
function expectChargeError(fn: () => void, message: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ChargeValidationError);
    if (e instanceof ChargeValidationError) {
      expect(e.status).toBe(400);
      expect(e.message).toBe(message);
      return;
    }
  }
  throw new Error(`expected ChargeValidationError("${message}"), but none was thrown`);
}

/** A line that passes validation. */
const validLine = {
  description: "Overnight stay",
  quantity: 1,
  unit_price: 100,
};

describe("validateLineItems", () => {
  it("rejects a non-array or empty items list", () => {
    expectChargeError(() => validateLineItems(undefined as never), "items must be a non-empty array");
    expectChargeError(() => validateLineItems([] as never), "items must be a non-empty array");
    expectChargeError(() => validateLineItems("nope" as never), "items must be a non-empty array");
  });

  it("rejects a non-object line", () => {
    expectChargeError(
      () => validateLineItems([42] as never),
      "items[0] must be an object",
    );
  });

  it("requires a non-blank description per item", () => {
    expectChargeError(
      () => validateLineItems([{ ...validLine, description: "" }]),
      "items[0] missing description",
    );
    expectChargeError(
      () => validateLineItems([{ ...validLine, description: "   " }]),
      "items[0] missing description",
    );
    expectChargeError(
      () => validateLineItems([{ ...validLine, description: undefined }]),
      "items[0] missing description",
    );
  });

  it("requires quantity to be a finite number > 0", () => {
    expectChargeError(
      () => validateLineItems([{ ...validLine, quantity: 0 }]),
      "items[0].quantity must be > 0",
    );
    expectChargeError(
      () => validateLineItems([{ ...validLine, quantity: -3 }]),
      "items[0].quantity must be > 0",
    );
    expectChargeError(
      () => validateLineItems([{ ...validLine, quantity: Infinity }]),
      "items[0].quantity must be > 0",
    );
    expectChargeError(
      () => validateLineItems([{ ...validLine, quantity: "2" }]),
      "items[0].quantity must be > 0",
    );
  });

  it("requires unit_price to be >= 0 and within NUMERIC(12,2)", () => {
    expectChargeError(
      () => validateLineItems([{ ...validLine, unit_price: -0.01 }]),
      "items[0].unit_price must be >= 0",
    );
    expectChargeError(
      () => validateLineItems([{ ...validLine, unit_price: NaN }]),
      "items[0].unit_price must be >= 0",
    );
    // Above the ledger's NUMERIC(12,2) ceiling → clean 400, not a DB crash.
    expectChargeError(
      () => validateLineItems([{ ...validLine, unit_price: MAX_NUMERIC_12_2 + 1 }]),
      `items[0].unit_price must not exceed ${MAX_NUMERIC_12_2}`,
    );
    // Boundary value itself is accepted.
    expect(() => validateLineItems([{ ...validLine, unit_price: MAX_NUMERIC_12_2 }])).not.toThrow();
  });

  it("rejects half a package reference (must carry both, or neither)", () => {
    expectChargeError(
      () => validateLineItems([{ ...validLine, package_id: 7 }]),
      "items[0] must carry both package_id and package_variant_id, or neither",
    );
    expectChargeError(
      () => validateLineItems([{ ...validLine, package_variant_id: 9 }]),
      "items[0] must carry both package_id and package_variant_id, or neither",
    );
    // Both present (even 0, which nothing else rejects here) passes.
    expect(() =>
      validateLineItems([{ ...validLine, package_id: 7, package_variant_id: 9 }]),
    ).not.toThrow();
  });

  it("requires package refs to be positive integers", () => {
    expectChargeError(
      () => validateLineItems([{ ...validLine, package_id: 0, package_variant_id: 9 }]),
      "items[0].package_id must be a positive integer",
    );
    expectChargeError(
      () => validateLineItems([{ ...validLine, package_id: -1, package_variant_id: 9 }]),
      "items[0].package_id must be a positive integer",
    );
    expectChargeError(
      () => validateLineItems([{ ...validLine, package_id: 7, package_variant_id: 0 }]),
      "items[0].package_variant_id must be a positive integer",
    );
  });

  it("only allows hour/day/month duration units", () => {
    expectChargeError(
      () => validateLineItems([{ ...validLine, duration_unit: "week" }]),
      "items[0].duration_unit must be one of: hour, day, month",
    );
    expectChargeError(
      () => validateLineItems([{ ...validLine, duration_unit: 7 }]),
      "items[0].duration_unit must be one of: hour, day, month",
    );
    for (const u of ["hour", "day", "month"]) {
      expect(() =>
        validateLineItems([{ ...validLine, duration_unit: u, duration_value: 2 }]),
      ).not.toThrow();
    }
  });

  it("requires a positive duration_value when duration_unit is set (and ignores it when not)", () => {
    expectChargeError(
      () => validateLineItems([{ ...validLine, duration_unit: "day", duration_value: 0 }]),
      "items[0].duration_value must be > 0 when duration_unit is set",
    );
    expectChargeError(
      () => validateLineItems([{ ...validLine, duration_unit: "day", duration_value: -2 }]),
      "items[0].duration_value must be > 0 when duration_unit is set",
    );
    // A duration_value with no unit is simply ignored.
    expect(() => validateLineItems([{ ...validLine, duration_value: 3 }])).not.toThrow();
  });

  it("requires client_id to be a positive integer when present", () => {
    expectChargeError(
      () => validateLineItems([{ ...validLine, client_id: 0 }]),
      "items[0].client_id must be a positive integer",
    );
    expectChargeError(
      () => validateLineItems([{ ...validLine, client_id: "c1" }]),
      "items[0].client_id must be a positive integer",
    );
    // Omitted client_id (manual line) is fine.
    expect(() => validateLineItems([validLine])).not.toThrow();
  });

  it("accepts a fully valid line", () => {
    expect(() => validateLineItems([validLine])).not.toThrow();
  });
});

describe("validateChargePayload", () => {
  const validPayload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    destination_account_id: 1,
    items: [validLine],
    ...over,
  });

  it("requires destination_account_id", () => {
    expectChargeError(
      () => validateChargePayload(validPayload({ destination_account_id: undefined }) as never),
      "destination_account_id is required",
    );
    expectChargeError(
      () => validateChargePayload(validPayload({ destination_account_id: 0 }) as never),
      "destination_account_id is required",
    );
  });

  it("requires transaction_date and started_at to be provided together", () => {
    expectChargeError(
      () => validateChargePayload(validPayload({ transaction_date: "2026-06-20" }) as never),
      "transaction_date and started_at must be provided together",
    );
    expectChargeError(
      () => validateChargePayload(validPayload({ started_at: "2026-06-20T10:00:00Z" }) as never),
      "transaction_date and started_at must be provided together",
    );
    // Both present is fine.
    expect(() =>
      validateChargePayload(
        validPayload({ transaction_date: "2026-06-20", started_at: "2026-06-20T10:00:00Z" }) as never,
      ),
    ).not.toThrow();
  });

  it("requires transaction_date to be YYYY-MM-DD", () => {
    expectChargeError(
      () =>
        validateChargePayload(
          validPayload({ transaction_date: "2026/06/20", started_at: "2026-06-20T10:00:00Z" }) as never,
        ),
      "transaction_date must be YYYY-MM-DD",
    );
  });

  it("requires started_at to be a valid ISO timestamp", () => {
    expectChargeError(
      () =>
        validateChargePayload(
          validPayload({ transaction_date: "2026-06-20", started_at: "not-a-time" }) as never,
        ),
      "started_at must be a valid ISO timestamp",
    );
    expectChargeError(
      () =>
        validateChargePayload(
          validPayload({ transaction_date: "2026-06-20", started_at: 1234 }) as never,
        ),
      "started_at must be a valid ISO timestamp",
    );
  });

  it("requires amount_collected to be a non-negative number", () => {
    expectChargeError(
      () => validateChargePayload(validPayload({ amount_collected: -1 }) as never),
      "amount_collected must be a non-negative number",
    );
    expectChargeError(
      () => validateChargePayload(validPayload({ amount_collected: "50" }) as never),
      "amount_collected must be a non-negative number",
    );
  });

  it("requires voucher_code to be a string", () => {
    expectChargeError(
      () => validateChargePayload(validPayload({ voucher_code: 123 }) as never),
      "voucher_code must be a string",
    );
  });

  it("rejects a top-level started_at when customer_groups is present", () => {
    expectChargeError(
      () =>
        validateChargePayload(
          validPayload({
            customer_groups: [{ is_payer: true, display_name: "A", item_indices: [0] }],
            started_at: "2026-06-20T10:00:00Z",
          }) as never,
        ),
      "started_at is not allowed at the top level when customer_groups is present (use customer_groups[].started_at instead)",
    );
  });

  it("delegates to validateCustomerGroups when customer_groups is present (bad groups → 400)", () => {
    expectChargeError(
      () =>
        validateChargePayload(
          validPayload({ customer_groups: [] as never }) as never,
        ),
      "customer_groups must be a non-empty array",
    );
  });

  it("accepts a valid payload", () => {
    expect(() => validateChargePayload(validPayload() as never)).not.toThrow();
  });
});

describe("validateCustomerGroups", () => {
  const group = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    display_name: "Walk-in A",
    is_payer: true,
    item_indices: [0],
    ...over,
  });

  it("rejects a non-empty-array violation (empty or non-array)", () => {
    expectChargeError(
      () => validateCustomerGroups([] as never, 1),
      "customer_groups must be a non-empty array",
    );
    expectChargeError(
      () => validateCustomerGroups("nope" as never, 1),
      "customer_groups must be a non-empty array",
    );
  });

  it("requires display_name to be a non-empty string", () => {
    expectChargeError(
      () => validateCustomerGroups([group({ display_name: "" })], 1),
      "customer_groups[0].display_name is required",
    );
    expectChargeError(
      () => validateCustomerGroups([group({ display_name: "   " })], 1),
      "customer_groups[0].display_name is required",
    );
  });

  it("requires client_id to be a positive integer when present", () => {
    expectChargeError(
      () => validateCustomerGroups([group({ client_id: 0 })], 1),
      "customer_groups[0].client_id must be a positive integer",
    );
    expectChargeError(
      () => validateCustomerGroups([group({ client_id: -2 })], 1),
      "customer_groups[0].client_id must be a positive integer",
    );
  });

  it("requires voucher_id to be a positive integer when present", () => {
    expectChargeError(
      () => validateCustomerGroups([group({ voucher_id: 0 })], 1),
      "customer_groups[0].voucher_id must be a positive integer",
    );
    expectChargeError(
      () => validateCustomerGroups([group({ voucher_id: 1.5 })], 1),
      "customer_groups[0].voucher_id must be a positive integer",
    );
  });

  it("requires started_at to be a valid ISO timestamp when present", () => {
    expectChargeError(
      () => validateCustomerGroups([group({ started_at: "bad" })], 1),
      "customer_groups[0].started_at must be a valid ISO timestamp",
    );
    // A real ISO timestamp passes.
    expect(() =>
      validateCustomerGroups([group({ started_at: "2026-06-20T10:00:00Z" })], 1),
    ).not.toThrow();
  });

  it("requires exactly one payer across all groups", () => {
    expectChargeError(
      () => validateCustomerGroups([group({ is_payer: false })], 1),
      "exactly one customer_groups entry must have is_payer=true",
    );
    expectChargeError(
      () =>
        validateCustomerGroups(
          [group({ is_payer: true }), group({ is_payer: true, item_indices: [1] })],
          2,
        ),
      "exactly one customer_groups entry must have is_payer=true",
    );
  });

  it("rejects item_indices outside [0, items.length)", () => {
    expectChargeError(
      () => validateCustomerGroups([group({ item_indices: [1] })], 1),
      "customer_groups[0].item_indices must be integers in [0, items.length)",
    );
    expectChargeError(
      () => validateCustomerGroups([group({ item_indices: [-1] })], 1),
      "customer_groups[0].item_indices must be integers in [0, items.length)",
    );
    expectChargeError(
      () => validateCustomerGroups([group({ item_indices: [0.5] })], 1),
      "customer_groups[0].item_indices must be integers in [0, items.length)",
    );
  });

  it("rejects an item claimed by more than one group", () => {
    expectChargeError(
      () =>
        validateCustomerGroups(
          [group({ item_indices: [0] }), { ...group({ is_payer: false }), item_indices: [0] }],
          1,
        ),
      "items[0] is claimed by more than one customer group",
    );
  });

  it("requires every item to be claimed (clean partition)", () => {
    // One of two items left unclaimed.
    expectChargeError(
      () => validateCustomerGroups([group({ item_indices: [0] })], 2),
      "every item must be claimed by exactly one customer group",
    );
  });

  it("accepts a clean partition across multiple groups", () => {
    expect(() =>
      validateCustomerGroups(
        [
          group({ item_indices: [0, 1] }),
          { is_payer: false, display_name: "Walk-in B", item_indices: [2] },
        ],
        3,
      ),
    ).not.toThrow();
  });
});