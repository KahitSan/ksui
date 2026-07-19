// Extracted from transactions-cart-edit.ts's apply-cart-edit handler — the
// route's own cyclomatic complexity crossed the review-ops Lens 14 CRITICAL
// gate, and this block (an existing group's voucher_id UPDATE + the
// costDeltaByGroup seed for a voucher-only change) is self-contained enough
// to isolate without touching the surrounding reduction/addition/reprice
// flow.
import type { PoolClient } from "pg";
import { findVoucherById, type IdentityHeader } from "./peers.js";

export interface VoucherChangeInput {
  customer_group_id: number;
  voucher_id: number | null;
}

/** Resolves each requested voucher_changes voucher_id via the vouchers RPC,
 *  matching additionVariantIds' resolve-before-BEGIN precedent in the route.
 *  Returns the first unresolvable id, or null once every id resolves. */
export async function findUnresolvableVoucherChangeId(
  voucherIds: number[],
  idh: IdentityHeader,
): Promise<number | null> {
  for (const vid of voucherIds) {
    const voucher = await findVoucherById(vid, idh);
    if (voucher == null) return vid;
  }
  return null;
}

// A result union (not a thrown error) keeps the caller's own guard to a
// single `if (!result.ok)` — one branch, matching every other pre-BEGIN/
// in-transaction guard in the handler instead of adding a dedicated
// try/catch just for this one case.
export type ApplyVoucherChangesResult =
  | { ok: true; voucherChangedGroupIds: number[] }
  | { ok: false; status: number; error: string };

/** Applies each voucher_changes entry inside the caller's already-open
 *  transaction (dbClient must be mid-BEGIN, same lock scope as the
 *  reduction/addition loops) and seeds costDeltaByGroup so a voucher-only
 *  change (no reduction/addition on that group) still gets visited by the
 *  reprice loop that runs after this. Applied BEFORE that reprice loop so
 *  its own fresh lockParentForReprice re-SELECT already sees the NEW
 *  voucher_id. Returns ok:false for a customer_group_id that doesn't belong
 *  to this transaction — the caller is responsible for the ROLLBACK,
 *  matching every other guard in the handler. */
export async function applyVoucherChanges(
  dbClient: PoolClient,
  workspaceId: number,
  transactionId: number,
  voucherChanges: VoucherChangeInput[],
  costDeltaByGroup: Map<number | null, number>,
): Promise<ApplyVoucherChangesResult> {
  const voucherChangedGroupIds: number[] = [];
  for (const vc of voucherChanges) {
    const cgExists = await dbClient.query<{ id: number }>(
      `SELECT id FROM accounts.transaction_customer_groups
         WHERE id = $1 AND transaction_id = $2 AND workspace_id = $3`,
      [vc.customer_group_id, transactionId, workspaceId],
    );
    if (cgExists.rows.length === 0) {
      return { ok: false, status: 404, error: "customer_group_id must belong to this transaction" };
    }
    await dbClient.query(
      `UPDATE accounts.transaction_customer_groups SET voucher_id = $1
         WHERE id = $2 AND transaction_id = $3 AND workspace_id = $4`,
      [vc.voucher_id, vc.customer_group_id, transactionId, workspaceId],
    );
    voucherChangedGroupIds.push(vc.customer_group_id);
    // A voucher-only change (no reduction/addition on this group) never
    // populated costDeltaByGroup — seed it at 0 so the reprice loop below
    // still visits the group instead of skipping a zero delta.
    if (!costDeltaByGroup.has(vc.customer_group_id)) costDeltaByGroup.set(vc.customer_group_id, 0);
  }
  return { ok: true, voucherChangedGroupIds };
}
