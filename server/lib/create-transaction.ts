// Shared transaction-insert core.
//
// The INSERT into accounts.transactions plus the two visibility-share inserts
// were previously inline in the POST / route. They're extracted here verbatim so
// the cross-plugin `createTransaction` service (server/main.ts) writes the EXACT
// same row shape as the HTTP route — one source of truth for the column list,
// the visibility-role grants, and the is_private gate. Callers own validation,
// VAT/EWT computation, and the surrounding BEGIN/COMMIT + applyTenantContext;
// this module only owns the writes.

import type { PoolClient } from "pg";

/** Every column the create path sets. Callers pass already-validated, already-
 *  computed values — this helper does no validation or VAT math. */
export interface TransactionInsert {
  workspaceId: number;
  category: string;
  subcategory: string | null;
  sourceAccountId: number | null;
  destinationAccountId: number | null;
  amount: number;
  description: string;
  notes: string | null;
  transactionDate: string;
  isPrivate: boolean;
  isBackdated: boolean;
  backdateReason: string | null;
  createdBy: string;
  referenceNumber: string | null;
  taxType: string;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
  payableKind: string | null;
  dueDate: string | null;
  chequeNumber: string | null;
  pdcStatus: string | null;
  hasEwt: boolean;
  ewtRate: number | null;
  ewtAmount: number | null;
  clientId: number | null;
  payeeId: number | null;
}

/** Insert the transaction row and return it. Must run inside a transaction the
 *  caller opened (BEGIN + applyTenantContext) so the visibility inserts share
 *  the same atomic commit. */
export async function insertTransactionRow(
  client: PoolClient,
  f: TransactionInsert,
): Promise<Record<string, unknown>> {
  const result = await client.query(
    `INSERT INTO accounts.transactions
       (workspace_id, category, subcategory, source_account_id, destination_account_id,
        amount, description, notes, transaction_date, is_private, is_backdated, backdate_reason,
        created_by, updated_by, reference_number, tax_type, tax_rate, tax_amount, subtotal,
        payable_kind, due_date, cheque_number, pdc_status, has_ewt, ewt_rate, ewt_amount, client_id,
        payee_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14, $15, $16, $17, $18,
             $19, $20, $21, $22, $23, $24, $25, $26, $27)
     RETURNING *`,
    [
      f.workspaceId,
      f.category,
      f.subcategory,
      f.sourceAccountId,
      f.destinationAccountId,
      f.amount,
      f.description,
      f.notes,
      f.transactionDate,
      f.isPrivate,
      f.isBackdated,
      f.backdateReason,
      f.createdBy,
      f.referenceNumber,
      f.taxType,
      f.taxRate,
      f.taxAmount,
      f.subtotal,
      f.payableKind,
      f.dueDate,
      f.chequeNumber,
      f.pdcStatus,
      f.hasEwt,
      f.ewtRate,
      f.ewtAmount,
      f.clientId,
      f.payeeId,
    ],
  );
  return result.rows[0];
}

/** Insert per-user and per-role visibility grants for a private transaction.
 *  No-op when the transaction isn't private or no shares are supplied. */
export async function insertVisibilityShares(
  client: PoolClient,
  transactionId: number,
  opts: { isPrivate: boolean; sharedWith?: unknown; sharedWithRoles?: unknown },
): Promise<void> {
  if (!opts.isPrivate) return;
  if (Array.isArray(opts.sharedWith) && opts.sharedWith.length > 0) {
    const values = opts.sharedWith.map((_: string, i: number) => `($1, $${i + 2})`).join(", ");
    await client.query(
      `INSERT INTO accounts.transaction_visibility (transaction_id, user_id) VALUES ${values}
         ON CONFLICT (transaction_id, user_id) DO NOTHING`,
      [transactionId, ...opts.sharedWith],
    );
  }
  if (Array.isArray(opts.sharedWithRoles) && opts.sharedWithRoles.length > 0) {
    const values = opts.sharedWithRoles.map((_: string, i: number) => `($1, $${i + 2})`).join(", ");
    await client.query(
      `INSERT INTO accounts.transaction_visibility_role (transaction_id, role_code) VALUES ${values}
         ON CONFLICT (transaction_id, role_code) DO NOTHING`,
      [transactionId, ...opts.sharedWithRoles],
    );
  }
}
