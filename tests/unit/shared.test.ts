import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import {
  SORTABLE_COLUMNS,
  VALID_CATEGORIES,
  VALID_STATUSES,
  VALID_TAX_TYPES,
  ISO_DATE_RE,
  isValidIsoDate,
  escapeLike,
  privacyClause,
} from "../../server/routes/shared.js";

// Pure validation/escaping helpers extracted from the transactions list/create
// handlers. These are the kind of logic that was previously only exercised by
// slow Playwright e2e; here it is asserted directly in ms.

describe("constants", () => {
  it("pins the category/status/tax allowlists (a create with a bad value must be rejected)", () => {
    expect(VALID_CATEGORIES).toEqual(["expense", "sale", "business", "payable"]);
    expect(VALID_STATUSES).toEqual(["pending", "completed", "voided"]);
    expect(VALID_TAX_TYPES).toEqual(["vat_inclusive", "vat_exclusive", "vat_exempt", "non_vat"]);
  });

  it("pins the sortable-column allowlist (guards the ORDER BY against injection)", () => {
    expect(SORTABLE_COLUMNS).toContain("transaction_date");
    expect(SORTABLE_COLUMNS).toContain("amount");
    // A column NOT in the list must never reach ORDER BY — this is the
    // allowlist the list handler switches on.
    expect(SORTABLE_COLUMNS).not.toContain("workspace_id");
    expect(SORTABLE_COLUMNS).not.toContain("1; DROP TABLE");
  });
});

describe("isValidIsoDate", () => {
  it("accepts well-formed YYYY-MM-DD", () => {
    expect(isValidIsoDate("2026-06-20")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true); // leap year
  });

  it("rejects calendar-impossible dates even when the regex shape matches", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false); // no Feb 30
    expect(isValidIsoDate("2026-13-01")).toBe(false); // month 13
    expect(isValidIsoDate("2026-00-10")).toBe(false); // month 0
    expect(isValidIsoDate("2023-02-29")).toBe(false); // 2023 not a leap year
  });

  it("rejects non-ISO / non-zero-padded shapes", () => {
    expect(isValidIsoDate("2026-6-20")).toBe(false); // not zero-padded
    expect(isValidIsoDate("2026/06/20")).toBe(false); // slashes
    expect(isValidIsoDate("06-20-2026")).toBe(false); // US order
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate("not-a-date")).toBe(false);
  });

  it("ISO_DATE_RE is the strict shape gate (anchored, zero-padded)", () => {
    expect(ISO_DATE_RE.test("2026-06-20")).toBe(true);
    expect(ISO_DATE_RE.test("2026-6-20")).toBe(false);
  });
});

describe("escapeLike", () => {
  it("escapes ILIKE wildcards so a search term cannot widen the match", () => {
    expect(escapeLike("100%")).toBe("100\\%"); // % → literal percent
    expect(escapeLike("a_b")).toBe("a\\_b"); // _ → literal underscore
    expect(escapeLike("back\\slash")).toBe("back\\\\slash"); // escape the escape char
    expect(escapeLike("plain")).toBe("plain"); // untouched
  });

  it("escapes every special in a compound term", () => {
    expect(escapeLike("%_\\")).toBe("\\%\\_\\\\");
  });
});

describe("privacyClause", () => {
  // Minimal req stub carrying only the fields privacyClause reads.
  const req = (over: Partial<{ wsRole: string; userId: string }> = {}): any =>
    ({
      wsRole: over.wsRole,
      user: over.userId ? { id: over.userId } : undefined,
    }) as any;

  it("returns null for an admin (admins bypass the privacy filter entirely)", () => {
    const params: unknown[] = [];
    expect(privacyClause(req({ wsRole: "admin", userId: "u1" }), params, 5)).toBeNull();
    expect(params).toHaveLength(0); // admin pushes no params
  });

  it("returns null for a superuser (kernel-level bypass)", () => {
    const params: unknown[] = [];
    const superuserReq = { user: { id: "u1", role: "superuser" } } as any;
    expect(privacyClause(superuserReq, params, 5)).toBeNull();
  });

  it("builds a visibility fragment for a non-admin and pushes exactly two params", () => {
    const params: unknown[] = [];
    const frag = privacyClause(req({ wsRole: "member", userId: "u9" }), params, 5);
    expect(frag).not.toBeNull();
    expect(frag).toContain("t.is_private = false");
    expect(frag).toContain("t.created_by = $5"); // startIdx honored
    expect(frag).toContain("transaction_visibility");
    expect(frag).toContain("role_code = $6"); // wsRole placeholder
    expect(params).toEqual(["u9", "member"]); // userId then wsRole
  });
});
