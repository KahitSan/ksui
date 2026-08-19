import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { allocateInvoiceNumber } from "../../server/lib/invoice-number.js";

const pool = new pg.Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "ks_erp",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});

const workspaceId = 2_000_000 + crypto.randomInt(800_000_000);
let ready = false;

beforeAll(async () => {
  const probe = await pool.query<{ name: string | null }>(
    "SELECT to_regclass('accounts.invoice_settings')::text AS name",
  );
  ready = probe.rows[0]?.name === "accounts.invoice_settings";
});

afterAll(async () => {
  await pool.end();
});

describe("invoice numbering against real Postgres", () => {
  it("excludes expenses, honors July cutoff, and advances custom sales", async () => {
    if (!ready) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO accounts.invoice_settings (workspace_id, enabled, first_number, next_number, prefix)
         VALUES ($1, TRUE, 101, 101, 'INV-')
         ON CONFLICT (workspace_id) DO UPDATE SET enabled = TRUE, first_number = 101, next_number = 101, prefix = 'INV-'`,
        [workspaceId],
      );

      await expect(allocateInvoiceNumber(client, workspaceId, "expense", "2026-08-18", null)).resolves.toBeNull();
      await expect(allocateInvoiceNumber(client, workspaceId, "sale", "2026-06-30", null)).resolves.toBeNull();
      await expect(allocateInvoiceNumber(client, workspaceId, "sale", "2026-07-01", null)).resolves.toBe("INV-101");
      await expect(allocateInvoiceNumber(client, workspaceId, "sale", "2026-07-01", "INV-150")).resolves.toBe("INV-150");

      const row = await client.query<{ next_number: number }>(
        "SELECT next_number FROM accounts.invoice_settings WHERE workspace_id = $1",
        [workspaceId],
      );
      expect(row.rows[0]?.next_number).toBe(151);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
