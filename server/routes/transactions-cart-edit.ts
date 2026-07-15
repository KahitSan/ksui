// POST /api/transactions/:id/apply-cart-edit — the reduction half of the
// edit-cart flow (voids/quantity-decreases on the SAME paid transaction).
// Kept out of run-charge.ts (INSERT-only by contract) and off makeDataSurface
// (needs FOR UPDATE row locks + multi-statement control flow), matching the
// line-items-extend.ts / transactions-status.ts /void precedent.

import { Hono } from "hono";
import { applyTenantContext, identityHeaderOf } from "@kahitsan/plugin-sdk";
import type { CoreRouteCtx } from "./transactions-core.js";
import { ctxGet } from "../types.js";
import { assertParentEditable, lockParentForReprice, repriceParentTransaction } from "../lib/reprice-parent-transaction.js";

interface ReductionInput {
  customer_group_id: number | null;
  package_id: number;
  package_variant_id: number;
  target_quantity: number;
}

interface CartEditBody {
  edit_token?: string;
  reason?: string;
  reductions?: ReductionInput[];
}

interface LockedLineRow {
  id: number;
  quantity: string;
  unit_price: string;
}

function isValidReduction(r: unknown): r is ReductionInput {
  if (r == null || typeof r !== "object") return false;
  const v = r as Record<string, unknown>;
  const cgOk = v.customer_group_id === null || typeof v.customer_group_id === "number";
  const pkgOk = typeof v.package_id === "number" && v.package_id > 0;
  const varOk = typeof v.package_variant_id === "number" && v.package_variant_id > 0;
  const qtyOk = typeof v.target_quantity === "number" && Number.isInteger(v.target_quantity) && v.target_quantity >= 0;
  return cgOk && pkgOk && varOk && qtyOk;
}

export function registerTransactionCartEditRoute(router: Hono, ctx: CoreRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  router.post(
    "/:id/apply-cart-edit",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      const id = parseInt(String(c.req.param("id")), 10);
      if (!Number.isFinite(id)) {
        return c.json({ error: "Invalid id" }, 400);
      }
      const body = (await c.req.json().catch(() => ({}))) as CartEditBody;
      const editToken = body.edit_token;
      const reason = body.reason;
      const reductions = body.reductions;
      if (!editToken || !String(editToken).trim()) {
        return c.json({ error: "edit_token is required" }, 400);
      }
      if (!reason || !String(reason).trim()) {
        return c.json({ error: "reason is required" }, 400);
      }
      if (!Array.isArray(reductions) || reductions.length === 0) {
        return c.json({ error: "reductions must be a non-empty array" }, 400);
      }
      if (!reductions.every(isValidReduction)) {
        return c.json({ error: "Each reduction needs package_id, package_variant_id, and an integer target_quantity >= 0" }, 400);
      }

      const workspaceId = ctxGet(c, "workspaceId");
      const userId = ctxGet(c, "user")?.id;
      const idh = identityHeaderOf(c);
      let dbClient: import("pg").PoolClient | null = null;
      try {
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);

        // Parent FOR UPDATE lock acquired FIRST, before the replay check —
        // two concurrent requests with the same edit_token both contend on
        // this row, so the loser blocks until the winner's transaction_edits
        // INSERT commits, then its replay lookup (below) finds that row
        // instead of racing past it into a second void.
        const locked = await lockParentForReprice(dbClient, workspaceId, id, null);
        if (locked == null) {
          await dbClient.query("ROLLBACK");
          return c.json({ error: "Transaction not found in this workspace" }, 404);
        }
        const editable = assertParentEditable(locked.parentTxn);
        if (!editable.ok) {
          await dbClient.query("ROLLBACK");
          return c.json({ error: editable.error }, 409);
        }

        // transaction_edits is INSERT/SELECT-only under RLS (append-only
        // audit trail, no UPDATE policy), so edit_id is merged in from the
        // row's own id here rather than stored inside payload by a
        // follow-up UPDATE.
        const replay = await dbClient.query<{ id: number; payload: Record<string, unknown> }>(
          `SELECT id, payload FROM accounts.transaction_edits
             WHERE transaction_id = $1 AND workspace_id = $2 AND idempotency_key = $3`,
          [id, workspaceId, String(editToken).trim()],
        );
        if (replay.rows.length > 0) {
          await dbClient.query("ROLLBACK");
          return c.json({ ...replay.rows[0].payload, edit_id: replay.rows[0].id });
        }

        // Per-customer-group signed cost delta, accumulated across every
        // reduction entry that targets that group (including the synthetic
        // `null` legacy/single-cg bucket).
        const costDeltaByGroup = new Map<number | null, number>();
        const voidedLineItemIds: number[] = [];
        const reducedLineItems: Array<{ id: number; quantity: number }> = [];

        for (const reduction of reductions) {
          const rowsRes = await dbClient.query<LockedLineRow>(
            `SELECT id, quantity, unit_price FROM accounts.transaction_line_items
               WHERE transaction_id = $1 AND workspace_id = $2
                 AND customer_group_id IS NOT DISTINCT FROM $3
                 AND package_id = $4 AND package_variant_id = $5
                 AND status IN ('active', 'completed', 'expired')
               ORDER BY id DESC
               FOR UPDATE`,
            [id, workspaceId, reduction.customer_group_id, reduction.package_id, reduction.package_variant_id],
          );
          if (rowsRes.rows.length === 0) {
            await dbClient.query("ROLLBACK");
            return c.json({ error: "No active line items match a requested reduction" }, 404);
          }
          const currentAggregate = rowsRes.rows.reduce((sum, r) => sum + parseFloat(r.quantity), 0);
          if (reduction.target_quantity >= currentAggregate) {
            await dbClient.query("ROLLBACK");
            return c.json({ error: "target_quantity must be less than the current active quantity" }, 400);
          }

          // LIFO: undo the most-recently-added row for this combo first, so a
          // later /extend addition on top of an original line unwinds before
          // the original line does.
          let remaining = currentAggregate - reduction.target_quantity;
          let groupDelta = costDeltaByGroup.get(reduction.customer_group_id) ?? 0;
          for (const row of rowsRes.rows) {
            if (remaining <= 0) break;
            const rowQty = parseFloat(row.quantity);
            const unitPrice = parseFloat(row.unit_price);
            if (rowQty <= remaining) {
              await dbClient.query(
                `UPDATE accounts.transaction_line_items SET status = 'voided', updated_at = NOW()
                   WHERE id = $1 AND workspace_id = $2`,
                [row.id, workspaceId],
              );
              voidedLineItemIds.push(row.id);
              groupDelta -= unitPrice * rowQty;
              remaining -= rowQty;
            } else {
              const newQty = rowQty - remaining;
              await dbClient.query(
                `UPDATE accounts.transaction_line_items SET quantity = $1, updated_at = NOW()
                   WHERE id = $2 AND workspace_id = $3`,
                [newQty, row.id, workspaceId],
              );
              reducedLineItems.push({ id: row.id, quantity: newQty });
              groupDelta -= unitPrice * remaining;
              remaining = 0;
            }
          }
          costDeltaByGroup.set(reduction.customer_group_id, groupDelta);
        }

        for (const [customerGroupId, costDelta] of costDeltaByGroup) {
          if (costDelta === 0) continue;
          const groupLock = await lockParentForReprice(dbClient, workspaceId, id, customerGroupId);
          if (groupLock == null) {
            await dbClient.query("ROLLBACK");
            return c.json({ error: "Transaction not found in this workspace" }, 404);
          }
          await repriceParentTransaction(dbClient, idh, workspaceId, userId, id, costDelta, groupLock);
        }

        // Family-aware: the counter UI routes cart additions to OTHER customers
        // through /charge as a CHILD transaction (parent_transaction_id = this
        // id), then calls this route to void the parent's own originals — so a
        // parent left with zero lines is not an empty RECEIPT if a linked,
        // non-voided child still carries active lines. The availment card
        // already renders parent+children as one receipt; this guard matches.
        const remainingCount = await dbClient.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM accounts.transaction_line_items li
             WHERE li.workspace_id = $2 AND li.status IN ('active', 'completed', 'expired')
               AND (
                 li.transaction_id = $1
                 OR li.transaction_id IN (
                   SELECT t.id FROM accounts.transactions t
                     WHERE t.workspace_id = $2 AND t.parent_transaction_id = $1 AND t.status != 'voided'
                 )
               )`,
          [id, workspaceId],
        );
        if (parseInt(remainingCount.rows[0].n, 10) === 0) {
          await dbClient.query("ROLLBACK");
          return c.json(
            { error: "At least one item must remain on this receipt. Void the whole transaction instead.", code: "EMPTY_CART" },
            409,
          );
        }

        const finalRes = await dbClient.query<{
          id: number;
          amount: string;
          subtotal: string | null;
          discount_amount: string;
        }>(
          `SELECT id, amount, subtotal, discount_amount FROM accounts.transactions
             WHERE id = $1 AND workspace_id = $2`,
          [id, workspaceId],
        );
        const finalTxn = finalRes.rows[0];
        const paidRes = await dbClient.query<{ total_paid: string }>(
          `SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS total_paid
             FROM accounts.transaction_payments WHERE transaction_id = $1 AND workspace_id = $2`,
          [id, workspaceId],
        );
        // Stays parent-scoped (not family-wide like EMPTY_CART above): a child
        // added via /charge carries its OWN amount + its OWN payments, so a
        // reduction on the parent can never leave a child's payment stranded
        // — the parent's own paid-vs-owed math is unaffected by the sibling.
        const newAmount = parseFloat(finalTxn.amount);
        const totalPaid = parseFloat(paidRes.rows[0].total_paid);
        if (newAmount < totalPaid) {
          await dbClient.query("ROLLBACK");
          return c.json(
            {
              error: `This would reduce the total below the ₱${totalPaid} already paid. Refunds are handled manually.`,
              code: "REFUND_BLOCKED",
              new_total: newAmount,
              already_paid: totalPaid,
            },
            409,
          );
        }

        const responseBody = {
          transaction: {
            id: finalTxn.id,
            amount: newAmount,
            subtotal: finalTxn.subtotal != null ? parseFloat(finalTxn.subtotal) : null,
            discount_amount: parseFloat(finalTxn.discount_amount),
            balance: Math.max(0, newAmount - totalPaid),
            payment_status: newAmount === 0 || totalPaid >= newAmount ? "paid" : totalPaid > 0 ? "partial" : "unpaid",
          },
          voided_line_item_ids: voidedLineItemIds,
          reduced_line_items: reducedLineItems,
        };

        // transaction_edits is INSERT/SELECT-only under RLS (append-only audit
        // trail, no UPDATE policy) — payload is stored WITHOUT edit_id (self-
        // referential, only known after this INSERT) and edit_id is merged
        // in from the row's own id on every read, matching the replay branch.
        const editRes = await dbClient.query<{ id: number }>(
          `INSERT INTO accounts.transaction_edits
             (transaction_id, workspace_id, edited_by, reason, kind, idempotency_key, payload)
           VALUES ($1, $2, $3, $4, 'cart_reduction', $5, $6::jsonb)
           RETURNING id`,
          [id, workspaceId, userId ?? "", String(reason).trim(), String(editToken).trim(), JSON.stringify(responseBody)],
        );

        await dbClient.query("COMMIT");
        return c.json({ ...responseBody, edit_id: editRes.rows[0].id });
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] apply-cart-edit error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );
}
