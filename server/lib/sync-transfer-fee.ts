// Synchronizes a transfer's linked fee-expense row after the transfer's PUT
// handler. The transfer edit-form is the only place a user changes the fee
// after creation; a direct edit of the fee expense row keeps that row's own
// amount in sync (no linkage change needed) — the transfer re-reads it on
// the next detail fetch via transfer_fee_transaction_id.

import type { PoolClient } from "pg";
import { insertTransactionRow, insertVisibilityShares } from "./create-transaction.js";

const TRANSFER_FEE_SUBCATEGORY = "Other expense";

export interface TransferFeeSyncInput {
  transferId: number;
  workspaceId: number;
  userId: string;
  effectiveCategory: string;
  effectiveDescription: string;
  effectiveSourceAccountId: number | null;
  effectiveTransactionDate: string;
  effectiveIsPrivate: boolean;
  effectiveIsBackdated: boolean;
  effectiveBackdateReason: string | null;
  existingFeeId: number | null;
  requestedFeeAmount: number | null;
}

export type TransferFeeSyncResult =
  | { ok: true; feeTransactionId: number | null }
  | { ok: false; error: string; status: 400 | 403 | 404 | 500 };

/** Apply the fee delta implied by the transfer edit. Must run inside the same
 *  BEGIN/COMMIT that already updated the transfer row. */
export async function syncTransferFee(
  client: PoolClient,
  f: TransferFeeSyncInput,
): Promise<TransferFeeSyncResult> {
  const dropFee = f.effectiveCategory !== "business" || f.requestedFeeAmount == null;

  if (dropFee) {
    if (f.existingFeeId != null) {
      await client.query(
        `UPDATE accounts.transactions SET transfer_fee_transaction_id = NULL
           WHERE id = $1 AND workspace_id = $2`,
        [f.transferId, f.workspaceId],
      );
      await client.query(
        `DELETE FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
        [f.existingFeeId, f.workspaceId],
      );
    }
    return { ok: true, feeTransactionId: null };
  }

  if (!f.effectiveSourceAccountId) {
    return { ok: false, status: 400, error: "transfer_fee_amount requires a source_account_id" };
  }
  // `dropFee` above guaranteed non-null; local narrows the type for the amount uses below.
  const feeAmount: number = f.requestedFeeAmount as number;
  const feeDescription = `Transfer fee — ${f.effectiveDescription}`;

  if (f.existingFeeId != null) {
    await client.query(
      `UPDATE accounts.transactions
          SET amount = $1, subtotal = $1, source_account_id = $2, description = $3,
              transaction_date = $4, is_private = $5, is_backdated = $6,
              backdate_reason = $7, updated_at = NOW(), updated_by = $8
        WHERE id = $9 AND workspace_id = $10`,
      [
        feeAmount,
        f.effectiveSourceAccountId,
        feeDescription,
        f.effectiveTransactionDate,
        f.effectiveIsPrivate,
        f.effectiveIsBackdated,
        f.effectiveBackdateReason,
        f.userId,
        f.existingFeeId,
        f.workspaceId,
      ],
    );
    return { ok: true, feeTransactionId: f.existingFeeId };
  }

  const feeTxn = await insertTransactionRow(client, {
    workspaceId: f.workspaceId,
    category: "expense",
    subcategory: TRANSFER_FEE_SUBCATEGORY,
    sourceAccountId: f.effectiveSourceAccountId,
    destinationAccountId: null,
    amount: feeAmount,
    description: feeDescription,
    notes: null,
    transactionDate: f.effectiveTransactionDate,
    isPrivate: f.effectiveIsPrivate,
    isBackdated: f.effectiveIsBackdated,
    backdateReason: f.effectiveBackdateReason,
    createdBy: f.userId,
    referenceNumber: null,
    taxType: "non_vat",
    taxRate: 12,
    taxAmount: 0,
    subtotal: feeAmount,
    payableKind: null,
    dueDate: null,
    chequeNumber: null,
    pdcStatus: null,
    hasEwt: false,
    ewtRate: null,
    ewtAmount: null,
    clientId: null,
    payeeId: null,
  });
  const feeId = feeTxn.id as number;
  await insertVisibilityShares(client, feeId, {
    isPrivate: f.effectiveIsPrivate,
    sharedWith: [],
    sharedWithRoles: [],
  });
  await client.query(
    `UPDATE accounts.transactions SET transfer_fee_transaction_id = $1
       WHERE id = $2 AND workspace_id = $3`,
    [feeId, f.transferId, f.workspaceId],
  );
  return { ok: true, feeTransactionId: feeId };
}
