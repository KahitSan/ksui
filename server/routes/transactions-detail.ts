// GET /:id detail handler — the fully enriched single-transaction read.
//
// registerTransactionDetailRoute mounts router.get("/:id", ...) and registers
// in its original position BETWEEN the Create and Edit registrars so the
// Express match order for the several '/:id' routes is byte-for-byte preserved.
//
// Extracted verbatim from transactions-core.ts. Carries the privacy check,
// attachments query, shared_with/shared_with_roles, line-items + package/
// variant/client RPC enrichment, billed-to client_name, edits, payments +
// account-name enrichment, customer_groups with dynamic display_name
// resolution, client_pool, payee resolution, and created_by/updated_by
// user-name resolution. Every query keeps its AND workspace_id = $N workspace
// scoping. Cross-plugin data is resolved over the kernel RPC (lib/peers.ts)
// with graceful degradation.

import { Hono } from "hono";
import { identityHeaderOf } from "@kahitsan/plugin-sdk";
import {
  findAccountsByIds,
  findPackagesByIds,
  findVariantsByIds,
  findClientsByIds,
  findPayeesByIds,
  findVoucherById,
  type VoucherRow,
} from "../lib/peers.js";
import { resolveUserNames, TRANSACTION_COLS_T } from "./shared.js";
import type { CoreRouteCtx } from "./transactions-core.js";
import { ctxGet, isWorkspaceElevated } from "../types.js";
import { summarizeActiveLines } from "../lib/active-line-summary.js";

export function registerTransactionDetailRoute(router: Hono, ctx: CoreRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  // ── Detail ────────────────────────────────────────────────────────────
  router.get(
    "/:id",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c) => {
      const id = parseInt(String(c.req.param("id")), 10);
      if (!Number.isFinite(id)) {
        return c.json({ error: "Invalid id" }, 400);
      }
      try {
        const result = await pool.query(
          `SELECT ${TRANSACTION_COLS_T},
            to_char(t.transaction_date, 'YYYY-MM-DD') AS transaction_date,
            paid.total_paid::numeric(12,2) AS amount_collected,
            (t.amount - paid.total_paid)::numeric(12,2) AS balance,
            fee.amount::numeric(12,2) AS transfer_fee_amount,
            CASE
              WHEN t.category != 'sale' THEN NULL
              WHEN t.status = 'voided' THEN 'voided'
              WHEN t.forfeited_at IS NOT NULL THEN 'forfeited'
              WHEN t.amount = 0 THEN 'paid'
              WHEN paid.total_paid >= t.amount THEN 'paid'
              WHEN paid.total_paid > 0 THEN 'partial'
              ELSE 'unpaid'
            END AS payment_status
          FROM accounts.transactions t
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(tp.amount), 0)::numeric(12,2) AS total_paid
              FROM accounts.transaction_payments tp WHERE tp.transaction_id = t.id
          ) paid ON true
          LEFT JOIN accounts.transactions fee
            ON fee.id = t.transfer_fee_transaction_id
           AND fee.workspace_id = t.workspace_id
          WHERE t.id = $1 AND t.workspace_id = $2`,
          [id, ctxGet(c, "workspaceId")],
        );
        if (result.rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        const txn = result.rows[0];
        const idh = identityHeaderOf(c);

        // Privacy check.
        if (txn.is_private && txn.created_by !== ctxGet(c, "user")?.id && !isWorkspaceElevated(c)) {
          const vis = await pool.query(
            `SELECT 1 FROM accounts.transaction_visibility WHERE transaction_id = $1 AND user_id = $2
             UNION ALL
             SELECT 1 FROM accounts.transaction_visibility_role WHERE transaction_id = $1 AND role_code = $3
             LIMIT 1`,
            [txn.id, ctxGet(c, "user")?.id, ctxGet(c, "wsRole") ?? ""],
          );
          if (vis.rows.length === 0) {
            return c.json({ error: "Not found" }, 404);
          }
        }

        const attachments = await pool.query(
          `SELECT id, transaction_id, file_name, file_size, mime_type, uploaded_by, s3_link, created_at
             FROM accounts.transaction_attachments WHERE transaction_id = $1 ORDER BY created_at`,
          [txn.id],
        );

        let shared_with: { user_id: string }[] = [];
        let shared_with_roles: { role_code: string }[] = [];
        if (txn.is_private && (txn.created_by === ctxGet(c, "user")?.id || isWorkspaceElevated(c))) {
          shared_with = (
            await pool.query(`SELECT user_id FROM accounts.transaction_visibility WHERE transaction_id = $1`, [txn.id])
          ).rows;
          shared_with_roles = (
            await pool.query(`SELECT role_code FROM accounts.transaction_visibility_role WHERE transaction_id = $1`, [txn.id])
          ).rows;
        }

        // Excludes voided lines: neither UI consumer of this field (the
        // "Packages availed" summary in TransactionDetail.tsx, the PUT-edit
        // form seed in useTransactionForm.ts) nor counter's receipt/edit
        // views want a voided line rendered as if it were still on the
        // receipt — counter's own load-edit-transaction.ts already filters
        // status === "voided" client-side, so this filter is a no-op for it
        // and a real fix for the two finance consumers that had none.
        const lineItemsResult = await pool.query(
          `SELECT id, package_id, package_variant_id, description, quantity, unit_price,
                  duration_value, duration_unit, started_at, ends_at, status, client_id, customer_group_id
             FROM accounts.transaction_line_items
            WHERE transaction_id = $1 AND workspace_id = $2 AND status <> 'voided'
            ORDER BY id ASC`,
          [txn.id, ctxGet(c, "workspaceId")],
        );

        // Enrich line items with package/variant/client names over RPC.
        const liPkgIds = [...new Set(lineItemsResult.rows.map((r) => r.package_id as number | null).filter((v): v is number => v != null))];
        const liVarIds = [...new Set(lineItemsResult.rows.map((r) => r.package_variant_id as number | null).filter((v): v is number => v != null))];
        const liClientIds = [...new Set(lineItemsResult.rows.map((r) => r.client_id as number | null).filter((v): v is number => v != null))];
        const [pkgs, vars, lineClients] = await Promise.all([
          liPkgIds.length > 0 ? findPackagesByIds(liPkgIds, idh) : Promise.resolve([]),
          liVarIds.length > 0 ? findVariantsByIds(liVarIds, idh) : Promise.resolve([]),
          liClientIds.length > 0 ? findClientsByIds(liClientIds, idh) : Promise.resolve([]),
        ]);
        const pkgName = new Map<number, string>((pkgs ?? []).map((p) => [p.id, p.name]));
        const varById = new Map((vars ?? []).map((v) => [v.id, v]));
        const lineClientName = new Map<number, string>((lineClients ?? []).map((c) => [c.id, c.name]));
        const line_items = lineItemsResult.rows.map((r) => {
          const variant = r.package_variant_id != null ? varById.get(r.package_variant_id) : undefined;
          return {
            ...r,
            package_name: r.package_id != null ? (pkgName.get(r.package_id) ?? null) : null,
            variant_name: variant?.name ?? null,
            variant_kind: variant?.kind ?? null,
            client_name: r.client_id != null ? (lineClientName.get(r.client_id) ?? null) : null,
          };
        });

        // Derived from the SAME already-enriched line_items the "Packages
        // availed" pane renders (same 3-line cap, same id-ascending order as
        // the list route's LATERAL) — package_name and description agree by
        // construction instead of the title being a separate SQL derivation
        // that can drift from the pane's resolution.
        if (line_items.length > 0) {
          txn.description = summarizeActiveLines(
            line_items.slice(0, 3).map((li) => ({
              quantity: li.quantity,
              description: li.description,
              package_name: li.package_name,
            })),
          );
        }

        // Billed-to client name.
        let client_name: string | null = null;
        if (txn.client_id != null) {
          const c = await findClientsByIds([txn.client_id], idh);
          client_name = c?.[0]?.name ?? null;
        }

        const edits = (
          await pool.query(
            `SELECT id, edited_at, reason, kind, edited_by
               FROM accounts.transaction_edits
              WHERE transaction_id = $1 AND workspace_id = $2
              ORDER BY edited_at DESC`,
            [txn.id, ctxGet(c, "workspaceId")],
          )
        ).rows;

        const payments = (
          await pool.query(
            `SELECT id, financial_account_id, amount, notes, created_at, customer_group_id
               FROM accounts.transaction_payments
              WHERE transaction_id = $1 AND workspace_id = $2
              ORDER BY created_at ASC, id ASC`,
            [txn.id, ctxGet(c, "workspaceId")],
          )
        ).rows;

        // Resolve account names for the transaction and its payment legs.
        const detailAccountIds = [
          ...new Set([
            ...(txn.source_account_id != null ? [txn.source_account_id as number] : []),
            ...(txn.destination_account_id != null ? [txn.destination_account_id as number] : []),
            ...payments.map((p) => p.financial_account_id as number | null).filter((v): v is number => v != null),
          ]),
        ];
        const detailAccounts =
          detailAccountIds.length > 0 ? await findAccountsByIds(detailAccountIds, idh) : [];
        const detailAcctById = new Map((detailAccounts ?? []).map((a) => [a.id, a]));
        txn.source_account_name =
          txn.source_account_id != null
            ? (detailAcctById.get(txn.source_account_id as number)?.name ?? null)
            : null;
        txn.destination_account_name =
          txn.destination_account_id != null
            ? (detailAcctById.get(txn.destination_account_id as number)?.name ?? null)
            : null;
        const enrichedPayments = payments.map((p) => {
          const acct =
            p.financial_account_id != null ? detailAcctById.get(p.financial_account_id as number) : undefined;
          return { ...p, financial_account_name: acct?.name ?? null };
        });

        const customerGroups = (
          await pool.query(
            `SELECT id, position, client_id, display_name, note, voucher_id, subtotal, discount_amount, is_payer
               FROM accounts.transaction_customer_groups
              WHERE transaction_id = $1 AND workspace_id = $2
              ORDER BY position ASC`,
            [txn.id, ctxGet(c, "workspaceId")],
          )
        ).rows;

        // Resolve client names for customer groups from the clients
        // plugin via RPC. This is the dynamic resolution for the
        // display_name field below.
        const cgClientIds = [
          ...new Set(customerGroups.map((g) => g.client_id as number | null).filter((v): v is number => v != null)),
        ];
        const cgClients =
          cgClientIds.length > 0 ? await findClientsByIds(cgClientIds, idh) : [];
        const cgClientName = new Map<number, string>((cgClients ?? []).map((c) => [c.id, c.name]));
        // display_name on transaction_customer_groups is a denormalized
        // snapshot written at charge time. It is the sole name source for
        // walk-in customers (client_id = NULL), but for client-linked
        // groups it duplicates data that the clients table owns. When
        // client_id changes (via the counter edit PATCH) or the client
        // renames, the stored column goes stale.
        //
        // Resolve dynamically from the clients table when client_id is set,
        // falling back to the stored value only when the clients RPC is
        // unavailable. Walk-ins (client_id = NULL) keep their stored name
        // because there is no other source.
        // Resolve each group's voucher over RPC (no batch endpoint exists on
        // the vouchers peer, so loop the small distinct set) so the edit cart
        // gets the real code/type/value plus the two fields its discount math
        // needs (max_discount_amount, minimum_purchase) instead of the raw id
        // alone — see load-edit-transaction.ts's placeholder comment. The raw
        // voucher_id column stays on the row regardless of resolution.
        const cgVoucherIds = [
          ...new Set(customerGroups.map((g) => g.voucher_id as number | null).filter((v): v is number => v != null)),
        ];
        const cgVoucherEntries = await Promise.all(
          cgVoucherIds.map(async (vid) => [vid, await findVoucherById(vid, idh)] as const),
        );
        const cgVoucherById = new Map<number, VoucherRow | null>(cgVoucherEntries);

        const customer_groups = customerGroups.map((g) => {
          const v = g.voucher_id != null ? (cgVoucherById.get(g.voucher_id) ?? null) : null;
          return {
            ...g,
            client_name: g.client_id != null ? (cgClientName.get(g.client_id) ?? null) : null,
            display_name: g.client_id != null ? (cgClientName.get(g.client_id) ?? g.display_name) : (g.display_name ?? null),
            voucher: v
              ? {
                  id: v.id,
                  code: v.code,
                  type: v.type,
                  value: v.value,
                  max_discount_amount: v.max_discount_amount ?? null,
                  minimum_purchase: v.minimum_purchase ?? null,
                }
              : null,
          };
        });

        const clientPoolRows = (
          await pool.query(
            `SELECT client_id, position FROM accounts.transaction_customers
              WHERE transaction_id = $1 AND workspace_id = $2 ORDER BY position ASC, client_id ASC`,
            [txn.id, ctxGet(c, "workspaceId")],
          )
        ).rows;
        const poolClients = clientPoolRows.length > 0
          ? await findClientsByIds(clientPoolRows.map((r) => r.client_id), idh)
          : [];
        const poolName = new Map<number, string>((poolClients ?? []).map((c) => [c.id, c.name]));
        const client_pool = clientPoolRows.map((r) => ({ id: r.client_id, name: poolName.get(r.client_id) ?? null }));

        // Resolve payee name.
        let payee: string | null = null;
        if (txn.payee_id != null) {
          const payees = await findPayeesByIds(pool, [txn.payee_id], ctxGet(c, "workspaceId"));
          payee = payees[0]?.name ?? null;
        }

        // Resolve user names (created_by / updated_by).
        const userIds = new Set<string>();
        if (txn.created_by) userIds.add(txn.created_by);
        if (txn.updated_by) userIds.add(txn.updated_by);
        const userMap = await resolveUserNames(pool, userIds);
        const createdByUser = txn.created_by ? userMap.get(txn.created_by) : undefined;
        const updatedByUser = txn.updated_by ? userMap.get(txn.updated_by) : undefined;

        return c.json({
          ...txn,
          payee,
          created_by_name: createdByUser?.name ?? null,
          created_by_image: createdByUser?.image ?? null,
          updated_by_name: updatedByUser?.name ?? null,
          updated_by_image: updatedByUser?.image ?? null,
          attachments: attachments.rows,
          shared_with,
          shared_with_roles,
          line_items,
          client_name,
          client_pool,
          customer_groups,
          edits,
          payments: enrichedPayments,
        });
      } catch (err) {
        console.error("[transactions] get error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );
}
