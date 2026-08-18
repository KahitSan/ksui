import { describe, expect, it, vi } from "vitest";
import { allocateInvoiceNumber } from "../../server/lib/invoice-number.js";

function clientFor(settings: { enabled: boolean; next_number: number; prefix: string }) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("to_regclass")) return { rows: [{ name: "accounts.invoice_settings" }] };
    if (sql.includes("SELECT enabled")) return { rows: [settings] };
    return { rows: [] };
  });
  return { query } as never as import("pg").PoolClient;
}

describe("allocateInvoiceNumber", () => {
  it("does not allocate for expenses", async () => {
    const client = clientFor({ enabled: true, next_number: 101, prefix: "" });
    await expect(allocateInvoiceNumber(client, 3, "expense", "2026-08-18", null)).resolves.toBeNull();
    expect((client as unknown as { query: ReturnType<typeof vi.fn> }).query).toHaveBeenCalledTimes(0);
  });

  it("does not allocate sales before July 1, 2026", async () => {
    const client = clientFor({ enabled: true, next_number: 101, prefix: "" });
    await expect(allocateInvoiceNumber(client, 3, "sale", "2026-06-30", null)).resolves.toBeNull();
    expect((client as unknown as { query: ReturnType<typeof vi.fn> }).query).toHaveBeenCalledTimes(0);
  });

  it("increments enabled sales from the configured next number", async () => {
    const client = clientFor({ enabled: true, next_number: 101, prefix: "INV-" });
    await expect(allocateInvoiceNumber(client, 3, "sale", "2026-07-01", null)).resolves.toBe("INV-101");
    expect((client as unknown as { query: ReturnType<typeof vi.fn> }).query).toHaveBeenCalledWith(
      expect.stringContaining("SET next_number = next_number + 1"),
      [3],
    );
  });

  it("keeps a custom invoice ID and moves the next number past numeric overrides", async () => {
    const client = clientFor({ enabled: true, next_number: 101, prefix: "INV-" });
    await expect(allocateInvoiceNumber(client, 3, "sale", "2026-07-01", "INV-150")).resolves.toBe("INV-150");
    expect((client as unknown as { query: ReturnType<typeof vi.fn> }).query).toHaveBeenCalledWith(
      expect.stringContaining("SET next_number = $2"),
      [3, 151],
    );
  });
});
