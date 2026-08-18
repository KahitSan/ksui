import type { PoolClient } from "pg";

export async function allocateInvoiceNumber(
  client: PoolClient,
  workspaceId: number,
  category: string,
  transactionDate: string,
  manualReference: string | null,
): Promise<string | null> {
  if (category !== "sale" || transactionDate < "2026-07-01") return manualReference;
  const table = await client.query<{ name: string | null }>(
    `SELECT to_regclass('accounts.invoice_settings')::text AS name`,
  );
  if (!table.rows[0]?.name) return null;
  const result = await client.query<{
    enabled: boolean;
    next_number: number;
    prefix: string;
  }>(
    `SELECT enabled, next_number, prefix
       FROM accounts.invoice_settings
      WHERE workspace_id = $1
      FOR UPDATE`,
    [workspaceId],
  );
  const settings = result.rows[0];
  if (!settings?.enabled) return manualReference;
  if (manualReference) {
    const digits = manualReference.startsWith(settings.prefix)
      ? manualReference.slice(settings.prefix.length)
      : "";
    const manualNumber = /^\d+$/.test(digits) ? Number(digits) : null;
    if (manualNumber != null && manualNumber >= settings.next_number) {
      await client.query(
        `UPDATE accounts.invoice_settings
            SET next_number = $2, updated_at = NOW()
          WHERE workspace_id = $1`,
        [workspaceId, manualNumber + 1],
      );
    }
    return manualReference;
  }
  await client.query(
    `UPDATE accounts.invoice_settings
        SET next_number = next_number + 1, updated_at = NOW()
      WHERE workspace_id = $1`,
    [workspaceId],
  );
  return `${settings.prefix}${settings.next_number}`;
}
