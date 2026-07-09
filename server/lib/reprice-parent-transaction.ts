// Shared re-pricing for extend/charge-overage: both bump a parent
// transaction's totals by a cost increase and must re-run the attached
// voucher's discount against the new subtotal instead of blindly adding the
// raw cost, or a voucher-discounted booking silently loses its discount.
import type { PoolClient } from "pg";
import { findVoucherById, type IdentityHeader } from "./peers.js";
import { computeVoucherDiscount, toNumberOrZero, type VoucherForDiscount } from "./voucher-discount.js";

interface ParentTransactionRow {
  id: number;
  subtotal: string | null;
  amount: string;
  discount_amount: string;
  voucher_id: number | null;
}

interface CustomerGroupRow {
  id: number;
  subtotal: string;
  discount_amount: string;
  voucher_id: number | null;
}

export interface LockedParentForReprice {
  parentTxn: ParentTransactionRow;
  cgRow: CustomerGroupRow | null;
}

/**
 * Locks the parent transaction (and its customer-group row, when set) FOR
 * UPDATE so a concurrent extend/charge-overage can't race the discount math.
 * Returns null when the parent transaction row isn't in this workspace.
 */
export async function lockParentForReprice(
  client: PoolClient,
  workspaceId: number,
  transactionId: number,
  customerGroupId: number | null,
): Promise<LockedParentForReprice | null> {
  const txnRes = await client.query(
    `SELECT id, subtotal, amount, discount_amount, voucher_id
       FROM accounts.transactions
      WHERE id = $1 AND workspace_id = $2
      FOR UPDATE`,
    [transactionId, workspaceId],
  );
  if (txnRes.rows.length === 0) return null;
  const parentTxn = txnRes.rows[0] as ParentTransactionRow;

  let cgRow: CustomerGroupRow | null = null;
  if (customerGroupId != null) {
    const cgRes = await client.query(
      `SELECT id, subtotal, discount_amount, voucher_id
         FROM accounts.transaction_customer_groups
        WHERE id = $1 AND workspace_id = $2
        FOR UPDATE`,
      [customerGroupId, workspaceId],
    );
    cgRow = cgRes.rows[0] ?? null;
  }
  return { parentTxn, cgRow };
}

/**
 * Bumps the parent transaction (and cg subtotal) by costIncrease, re-running
 * the attached voucher's discount (group-level takes precedence when a
 * customer group is set, matching run-charge.ts) against the new subtotal.
 */
export async function repriceParentForCostIncrease(
  client: PoolClient,
  idh: IdentityHeader,
  workspaceId: number,
  userId: number,
  transactionId: number,
  costIncrease: number,
  locked: LockedParentForReprice,
): Promise<void> {
  const { parentTxn, cgRow } = locked;
  const newParentSubtotal = toNumberOrZero(parentTxn.subtotal ?? parentTxn.amount) + costIncrease;
  const oldParentDiscount = toNumberOrZero(parentTxn.discount_amount);
  let newParentDiscount = oldParentDiscount;

  if (cgRow != null) {
    const oldCgSubtotal = toNumberOrZero(cgRow.subtotal);
    const oldCgDiscount = toNumberOrZero(cgRow.discount_amount);
    const newCgSubtotal = oldCgSubtotal + costIncrease;
    let newCgDiscount = oldCgDiscount;
    if (cgRow.voucher_id != null) {
      const voucher = await findVoucherById(cgRow.voucher_id, idh);
      if (voucher != null) {
        newCgDiscount = computeVoucherDiscount(
          newCgSubtotal,
          voucher as unknown as VoucherForDiscount,
        ).discountAmount;
      }
    }
    newParentDiscount = oldParentDiscount + (newCgDiscount - oldCgDiscount);
    await client.query(
      `UPDATE accounts.transaction_customer_groups
          SET subtotal = $1, discount_amount = $2
        WHERE id = $3 AND workspace_id = $4`,
      [newCgSubtotal, newCgDiscount, cgRow.id, workspaceId],
    );
  } else if (parentTxn.voucher_id != null) {
    const voucher = await findVoucherById(parentTxn.voucher_id, idh);
    if (voucher != null) {
      newParentDiscount = computeVoucherDiscount(
        newParentSubtotal,
        voucher as unknown as VoucherForDiscount,
      ).discountAmount;
    }
  }

  const newParentAmount = Math.max(0, newParentSubtotal - newParentDiscount);
  await client.query(
    `UPDATE accounts.transactions
        SET amount = $1, subtotal = $2, discount_amount = $3, updated_at = NOW(), updated_by = $4
      WHERE id = $5 AND workspace_id = $6`,
    [newParentAmount, newParentSubtotal, newParentDiscount, userId, transactionId, workspaceId],
  );
}
