import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const modal = readFileSync(
  resolve(process.cwd(), "ui/remote/components/TransactionCreateModal.tsx"),
  "utf8",
);
const styles = readFileSync(resolve(process.cwd(), "ui/remote/styles.css"), "utf8");

describe("transaction modal compact layout", () => {
  it("uses the compact modal size and a bounded scrolling form", () => {
    expect(modal).toContain('<Modal variant="sheet" size="md"');
    expect(styles).toContain(".ks-finance-transaction-modal form");
    expect(styles).toContain("height: min(calc(100dvh - 2rem), 760px)");
    expect(styles).toContain("overflow-y: auto");
  });
});
