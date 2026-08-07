import { describe, expect, it } from "vitest";
import { appliesToFor } from "../../server/lib/transaction-subcategories.js";

// appliesToFor maps a transaction.category to the income/expense taxonomy
// used to resolve subcategories. Internal transfers ('business') have no
// taxonomy side; any unrecognized category falls through to null too.

describe("appliesToFor", () => {
  it("maps sale to income", () => {
    expect(appliesToFor("sale")).toBe("income");
  });

  it("maps expense and payable to expense", () => {
    expect(appliesToFor("expense")).toBe("expense");
    expect(appliesToFor("payable")).toBe("expense");
  });

  it("returns null for business transfers and any unrecognized category", () => {
    expect(appliesToFor("business")).toBeNull();
    expect(appliesToFor("other")).toBeNull();
    expect(appliesToFor("random")).toBeNull();
  });
});