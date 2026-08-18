// Core transaction CRUD routes for the transactions router.
//
// registerCoreRoutes mounts: GET / (list with pagination/sort/filters/search),
// POST / (create), GET /:id (detail), PUT /:id (edit basic fields),
// DELETE /:id (soft-delete → status='voided'), POST /:id/void, POST /:id/unvoid,
// PUT /:id/visibility (replace per-user/per-role share grants),
// GET /:id/line-items, POST /:id/line-items/:lineItemId/void, and
// POST /:id/apply-cart-edit (reduction half of the edit-cart flow).
//
// registerCounterPatchRoutes mounts the three counter PATCH routes
// (/:id/client-pool, /:id/customer-group-started-at, /:id/customer-group-client),
// kept in a separate function so they register in their original position
// AFTER the attachment routes — preserving the exact Express match order.
//
// Extracted verbatim from routes.ts. Every query keeps its
// AND workspace_id = $N workspace scoping, the ends_at recompute CASE (hour/day/
// month intervals), the both-sides tenant delete in visibility, the natural-day
// posture, and all BEGIN/COMMIT/ROLLBACK unchanged. Cross-plugin data
// (package/variant/client/payee names, voucher discount) is resolved over the
// kernel RPC (lib/peers.ts) with graceful degradation.

import { Hono, type MiddlewareHandler } from "hono";
import { applyTenantContext } from "@kahitsan/plugin-sdk";
import { insertTransactionRow, insertVisibilityShares } from "../lib/create-transaction.js";
import { syncTransferFee } from "../lib/sync-transfer-fee.js";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { identityHeaderOf } from "@kahitsan/plugin-sdk";
import { findAccountsByIds, findPackagesByIds, findPayeesByIds } from "../lib/peers.js";
import { validateSubcategory } from "../lib/transaction-subcategories.js";
import { allocateInvoiceNumber } from "../lib/invoice-number.js";
import { isBackdated } from "../lib/backdate.js";
import { ACTIVE_LINE_ROWS_SQL, summarizeActiveLines, type ActiveLineRow } from "../lib/active-line-summary.js";
import { registerTransactionDetailRoute } from "./transactions-detail.js";
import { registerTransactionStatusRoutes } from "./transactions-status.js";
import { registerTransactionCartEditRoute } from "./transactions-cart-edit.js";
import { assertOrgOwnsRow } from "../charge/insert-line-items.js";
import { ChargeValidationError } from "../charge/validate.js";
import { ctxGet, isWorkspaceElevated } from "../types.js";
import {
  SORTABLE_COLUMNS,
  VALID_CATEGORIES,
  VALID_TAX_TYPES,
  TRANSACTION_COLS,
  TRANSACTION_COLS_T,
  MAX_NUMERIC_12_2,
  isValidIsoDate,
  resolveUserNames,
  privacyClause,
  applyTransactionListFilters,
  parseTransactionListQuery,
} from "./shared.js";

export type CoreRouteCtx = {
  pool: PluginDb;
  requireAuth: MiddlewareHandler;
  requireWorkspace: MiddlewareHandler;
  requirePermission: (...codes: string[]) => MiddlewareHandler;
};

const TRANSFER_FEE_SUBCATEGORY = "Other expense";

export function registerCoreRoutes(router: Hono, ctx: CoreRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  router.get(
    "/invoice-settings",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c) => {
      const result = await pool.query(
        `SELECT enabled, first_number, next_number, prefix FROM accounts.invoice_settings WHERE workspace_id = $1`,
        [ctxGet(c, "workspaceId")],
      );
      return c.json(result.rows[0] ?? { enabled: false, first_number: 101, next_number: 101, prefix: "" });
    },
  );
  router.put(
    "/invoice-settings",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      if (!isWorkspaceElevated(c)) return c.json({ error: "Workspace admin required" }, 403);
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.enabled !== "boolean") return c.json({ error: "enabled must be boolean" }, 400);
      const prefix = body.prefix === undefined ? "" : String(body.prefix);
      if (prefix.length > 20) return c.json({ error: "prefix is too long" }, 400);
      const nextNumber = body.next_number === undefined ? 100 : Number(body.next_number);
      const firstNumber = body.first_number === undefined ? nextNumber : Number(body.first_number);
      if (!Number.isInteger(firstNumber) || firstNumber < 1 || !Number.isInteger(nextNumber) || nextNumber < firstNumber) return c.json({ error: "next_number must be a positive integer" }, 400);
      const result = await pool.query(
        `INSERT INTO accounts.invoice_settings (workspace_id, enabled, first_number, next_number, prefix)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workspace_id) DO UPDATE SET enabled = EXCLUDED.enabled, first_number = EXCLUDED.first_number, next_number = EXCLUDED.next_number, prefix = EXCLUDED.prefix, updated_at = NOW()
         RETURNING enabled, first_number, next_number, prefix`,
        [ctxGet(c, "workspaceId"), body.enabled, firstNumber, nextNumber, prefix],
      );
      return c.json(result.rows[0]);
    },
  );
  router.get(
    "/next-invoice-id",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c) => {
      try {
        const result = await ctx.pool.query<{ reference_number: string }>(
          `SELECT reference_number
             FROM accounts.transactions
            WHERE workspace_id = $1
              AND category = 'sale'
              AND reference_number IS NOT NULL
              AND btrim(reference_number) <> ''
            ORDER BY id DESC
            LIMIT 1`,
          [ctxGet(c, "workspaceId")],
        );
        const last = result.rows[0]?.reference_number?.trim();
        if (!last) return c.json({ invoiceId: "INV-0001" });
        const match = last.match(/^(.*?)(\d+)$/);
        if (!match) return c.json({ invoiceId: `${last}-1` });
        const [, prefix, digits] = match;
        const next = String(Number(digits) + 1).padStart(digits.length, "0");
        return c.json({ invoiceId: `${prefix}${next}` });
      } catch (err) {
        console.error("[transactions] next invoice id error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  // ── List ────────────────────────────────────────────────────────────────
  router.get(
    "/",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c) => {
      const category = c.req.query("category") as string | undefined;
      const filters = parseTransactionListQuery(c);
      const sortBy = c.req.query("sortBy") as string | undefined;
      const sortDir = (c.req.query("sortDir") as string)?.toUpperCase() === "ASC" ? "ASC" : "DESC";
      const page = Math.max(1, parseInt(c.req.query("page") as string) || 1);
      const limit = Math.min(parseInt(c.req.query("limit") as string) || 25, 200);
      const offset = (page - 1) * limit;

      try {
        const conditions: string[] = ["t.workspace_id = $1"];
        const params: unknown[] = [ctxGet(c, "workspaceId")];

        const priv = privacyClause(c, params, params.length + 1);
        if (priv) conditions.push(priv);

        // category is list-specific (multi-value from the query); grouped-by-date
        // pins 'sale' instead. Everything after it is the shared filter set.
        if (category) {
          const cats = category.split(",").filter((c) => VALID_CATEGORIES.includes(c));
          if (cats.length === 1) {
            params.push(cats[0]);
            conditions.push(`t.category = $${params.length}`);
          } else if (cats.length > 1 && cats.length < VALID_CATEGORIES.length) {
            params.push(cats);
            conditions.push(`t.category = ANY($${params.length})`);
          }
        }

        applyTransactionListFilters(conditions, params, filters);

        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const sortColumn = SORTABLE_COLUMNS.includes(sortBy || "") ? sortBy : "transaction_date";
        const orderClause = `ORDER BY t.${sortColumn} ${sortDir}, t.id DESC`;

        const dataQuery = `
          SELECT ${TRANSACTION_COLS_T},
            to_char(t.transaction_date, 'YYYY-MM-DD') AS transaction_date,
            (SELECT COUNT(*) FROM accounts.transaction_attachments ta WHERE ta.transaction_id = t.id) AS attachment_count,
            paid.total_paid::numeric(12,2) AS amount_collected,
            (t.amount - paid.total_paid)::numeric(12,2) AS balance,
            li_summary.lines AS active_lines,
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
          LEFT JOIN LATERAL (
            -- apply-cart-edit now regenerates t.description in the same
            -- transaction as the swap (see transactions-cart-edit.ts), so
            -- this LATERAL is belt-and-suspenders for rows edited BEFORE
            -- that fix shipped — it heals them here without a backfill
            -- migration. Package-name resolution can't happen in SQL
            -- (packages lives in a separate plugin's schema, RPC-only —
            -- see peers.ts), so this returns the raw active lines; the
            -- code below labels them in JS via summarizeActiveLines, kept
            -- in sync with active-line-summary.ts's deriveActiveLineSummary.
            ${ACTIVE_LINE_ROWS_SQL}
          ) li_summary ON true
          ${whereClause}
          ${orderClause}
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        const result = await pool.query(dataQuery, params);

        const countParams = params.slice(0, -2);
        const countResult = await pool.query(
          `SELECT COUNT(*) FROM accounts.transactions t ${whereClause}`,
          countParams,
        );
        const total = parseInt(countResult.rows[0].count);

        // Enrich with account, payee, and user names.
        const idh = identityHeaderOf(c);

        // Resolve the active-lines summary now that package names (RPC-only,
        // see peers.ts) are reachable — batched once across every row rather
        // than per-row, matching the account/payee enrichment below. A row
        // with no active lines keeps its default t.description (already
        // selected via TRANSACTION_COLS_T), reproducing the old SQL COALESCE.
        const activeLinePackageIds = [
          ...new Set(
            result.rows.flatMap((r: { active_lines: ActiveLineRow[] }) =>
              r.active_lines.map((l) => l.package_id).filter((id): id is number => id != null),
            ),
          ),
        ];
        const activeLinePackages =
          activeLinePackageIds.length > 0 ? await findPackagesByIds(activeLinePackageIds, idh) : [];
        const activeLinePackageNameById = new Map<number, string>(
          (activeLinePackages ?? []).map((p) => [p.id, p.name]),
        );
        for (const row of result.rows) {
          const lines = row.active_lines as ActiveLineRow[];
          if (lines.length > 0) {
            row.description = summarizeActiveLines(
              lines.map((l) => ({
                quantity: l.quantity,
                description: l.description,
                package_name: l.package_id != null ? (activeLinePackageNameById.get(l.package_id) ?? null) : null,
              })),
            );
          }
          delete row.active_lines;
        }

        const accountIds = [
          ...new Set([
            ...result.rows.map((r: { source_account_id: number | null }) => r.source_account_id).filter((v: number | null): v is number => v != null),
            ...result.rows.map((r: { destination_account_id: number | null }) => r.destination_account_id).filter((v: number | null): v is number => v != null),
          ]),
        ];
        const accountsResult = accountIds.length > 0 ? await findAccountsByIds(accountIds, idh) : [];
        const accountMap = accountsResult
          ? new Map(accountsResult.map((a) => [a.id, a]))
          : null;

        const payeeIds = [...new Set(result.rows.map((r: { payee_id: number | null }) => r.payee_id).filter((v: number | null): v is number => v != null))];
        const payeeMap = payeeIds.length > 0
          ? new Map((await findPayeesByIds(pool, payeeIds, ctxGet(c, "workspaceId"))).map((p: { id: number; name: string }) => [p.id, p.name]))
          : new Map<number, string>();

        const userIds = new Set<string>();
        for (const row of result.rows) {
          if (row.created_by) userIds.add(row.created_by);
          if (row.updated_by) userIds.add(row.updated_by);
        }
        const userMap = await resolveUserNames(pool, userIds);

        const accountsUnavailable = accountIds.length > 0 && accountMap === null;

        for (const row of result.rows) {
          if (accountMap) {
            const src = row.source_account_id != null ? accountMap.get(row.source_account_id) : undefined;
            const dst = row.destination_account_id != null ? accountMap.get(row.destination_account_id) : undefined;
            row.source_account_name = src?.name ?? null;
            row.destination_account_name = dst?.name ?? null;
          } else {
            row.source_account_name = null;
            row.destination_account_name = null;
          }
          row.payee = row.payee_id != null ? (payeeMap.get(row.payee_id) ?? null) : null;
          const cUser = row.created_by ? userMap.get(row.created_by) : undefined;
          const uUser = row.updated_by ? userMap.get(row.updated_by) : undefined;
          row.created_by_name = cUser?.name ?? null;
          row.created_by_image = cUser?.image ?? null;
          row.updated_by_name = uUser?.name ?? null;
          row.updated_by_image = uUser?.image ?? null;
        }

        const body: Record<string, unknown> = { data: result.rows, total, page, limit, totalPages: Math.ceil(total / limit) };
        if (accountsUnavailable) {
          body.peersUnavailable = { accounts: true, payees: false };
        }
        return c.json(body);
      } catch (err) {
        console.error("[transactions] list error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  // ── Create (manual income/expense/business) ─────────────────────────────
  router.post(
    "/",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.create"),
    async (c) => {
      const {
        category,
        subcategory,
        source_account_id,
        destination_account_id,
        amount,
        description,
        notes,
        transaction_date,
        is_private,
        shared_with,
        shared_with_roles,
        backdate_reason,
        reference_number,
        tax_type,
        has_ewt,
        ewt_rate,
        payable_kind,
        due_date,
        cheque_number,
        pdc_status,
        payee_id,
        client_id,
        transfer_fee_amount,
      } = await c.req.json() ?? {};

      if (!category || !VALID_CATEGORIES.includes(category)) {
        return c.json({ error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` }, 400);
      }
      if (client_id != null && (typeof client_id !== "number" || !Number.isFinite(client_id))) {
        return c.json({ error: "client_id must be a finite number" }, 400);
      }
      if (payee_id != null && (typeof payee_id !== "number" || !Number.isFinite(payee_id))) {
        return c.json({ error: "payee_id must be a finite number" }, 400);
      }
      if (source_account_id != null && (typeof source_account_id !== "number" || !Number.isFinite(source_account_id))) {
        return c.json({ error: "source_account_id must be a finite number" }, 400);
      }
      if (destination_account_id != null && (typeof destination_account_id !== "number" || !Number.isFinite(destination_account_id))) {
        return c.json({ error: "destination_account_id must be a finite number" }, 400);
      }
      // Single computed value feeds both the INSERTs and the ownership check
      // below, so validation and persistence can never see different ids.
      const srcAccountId: number | null = source_account_id || null;
      const dstAccountId: number | null = destination_account_id || null;

      let validatedSubcategory: string | null;
      try {
        validatedSubcategory = await validateSubcategory(pool, category, subcategory);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : "Invalid subcategory" }, 400);
      }

      const parsedAmount = parseFloat(amount);
      // eslint-disable-next-line sonarjs/no-inverted-boolean-check -- !(x>0) also rejects NaN (non-numeric amount); `<=0` would let NaN through, changing validation.
      if (!amount || !(parsedAmount > 0)) {
        return c.json({ error: "amount must be greater than 0" }, 400);
      }
      if (parsedAmount > MAX_NUMERIC_12_2) {
        return c.json({ error: `amount must not exceed ${MAX_NUMERIC_12_2}` }, 400);
      }
      let parsedTransferFeeAmount: number | null = null;
      if (transfer_fee_amount !== undefined && transfer_fee_amount !== null) {
        if (category !== "business") {
          return c.json({ error: "transfer_fee_amount is only valid for transfers" }, 400);
        }
        parsedTransferFeeAmount = parseFloat(String(transfer_fee_amount));
        if (!Number.isFinite(parsedTransferFeeAmount) || parsedTransferFeeAmount <= 0) {
          return c.json({ error: "transfer_fee_amount must be greater than 0" }, 400);
        }
        if (parsedTransferFeeAmount > MAX_NUMERIC_12_2) {
          return c.json({ error: `transfer_fee_amount must not exceed ${MAX_NUMERIC_12_2}` }, 400);
        }
        if (srcAccountId == null) {
          return c.json({ error: "transfer_fee_amount requires a source_account_id" }, 400);
        }
      }
      if (!description || !String(description).trim()) {
        return c.json({ error: "description is required" }, 400);
      }
      if (!transaction_date || !isValidIsoDate(String(transaction_date))) {
        return c.json({ error: "transaction_date must be YYYY-MM-DD" }, 400);
      }
      if (!ctxGet(c, "workspaceId") || !ctxGet(c, "user")?.id) {
        return c.json({ error: "Workspace and user context required" }, 400);
      }

      // Backdate gate (transactions.backdate). Admin/superuser bypass.
      const backdated = isBackdated(String(transaction_date));
      if (backdated) {
        const allowed =
          isWorkspaceElevated(c) || (ctxGet(c, "permissions") ?? []).includes("transactions.backdate");
        if (!allowed) {
          return c.json({ error: "Missing permission: transactions.backdate" }, 403);
        }
        if (!backdate_reason?.trim()) {
          return c.json({ error: "backdate_reason is required when backdating" }, 400);
        }
      }

      // Payable-specific validation.
      const validPayableKinds = ["subscription", "utility", "rent", "loan", "tax", "other"];
      const validPdcStatuses = ["issued", "presented", "cleared", "bounced"];
      let txPayableKind: string | null = null;
      let txDueDate: string | null = null;
      let txChequeNumber: string | null = null;
      let txPdcStatus: string | null = null;
      if (category === "payable") {
        if (!payable_kind || !validPayableKinds.includes(payable_kind)) {
          return c.json({ error: `payable_kind must be one of: ${validPayableKinds.join(", ")}` }, 400);
        }
        txPayableKind = payable_kind;
        if (due_date) {
          if (typeof due_date !== "string" || !isValidIsoDate(due_date)) {
            return c.json({ error: "due_date must be YYYY-MM-DD" }, 400);
          }
          txDueDate = due_date;
        }
        txChequeNumber = cheque_number?.trim() || null;
        if (txChequeNumber && pdc_status && !validPdcStatuses.includes(pdc_status)) {
          return c.json({ error: `pdc_status must be one of: ${validPdcStatuses.join(", ")}` }, 400);
        }
        txPdcStatus = txChequeNumber ? pdc_status || "issued" : null;
      }

      // VAT computation.
      if (tax_type != null && !VALID_TAX_TYPES.includes(tax_type)) {
        return c.json({ error: `tax_type must be one of: ${VALID_TAX_TYPES.join(", ")}` }, 400);
      }
      const txTaxType = VALID_TAX_TYPES.includes(tax_type) ? tax_type : "vat_inclusive";
      const taxRate = 12.0;
      let subtotal: number;
      let taxAmount: number;
      if (txTaxType === "vat_inclusive") {
        subtotal = Math.round((parsedAmount / 1.12) * 100) / 100;
        taxAmount = Math.round((parsedAmount - subtotal) * 100) / 100;
      } else if (txTaxType === "vat_exclusive") {
        subtotal = parsedAmount;
        taxAmount = Math.round(parsedAmount * 0.12 * 100) / 100;
      } else {
        subtotal = parsedAmount;
        taxAmount = 0;
      }
      const storedAmount = txTaxType === "vat_exclusive" ? subtotal + taxAmount : parsedAmount;

      // EWT.
      let txHasEwt = false;
      let txEwtRate: number | null = null;
      let txEwtAmount: number | null = null;
      if (has_ewt === true) {
        const parsedRate = parseFloat(ewt_rate);
        if (!Number.isFinite(parsedRate) || parsedRate <= 0 || parsedRate > 100) {
          return c.json({ error: "ewt_rate must be a number greater than 0 and at most 100" }, 400);
        }
        txHasEwt = true;
        txEwtRate = parsedRate;
        txEwtAmount = Math.round(storedAmount * parsedRate) / 100;
      }

      let dbClient: import("pg").PoolClient | null = null;
      try {
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);

        // Cross-tenant guard: reject a source/destination account belonging
        // to a different workspace before it ever reaches the INSERT.
        if (srcAccountId != null) {
          await assertOrgOwnsRow(dbClient, "accounts.financial_accounts", srcAccountId, ctxGet(c, "workspaceId"), "source_account_id");
        }
        if (dstAccountId != null) {
          await assertOrgOwnsRow(dbClient, "accounts.financial_accounts", dstAccountId, ctxGet(c, "workspaceId"), "destination_account_id");
        }

        const invoiceReference = await allocateInvoiceNumber(
          dbClient,
          ctxGet(c, "workspaceId"),
          category,
          String(transaction_date),
          reference_number?.trim() || null,
        );
        const txn = await insertTransactionRow(dbClient, {
          workspaceId: ctxGet(c, "workspaceId"),
          category,
          subcategory: validatedSubcategory,
          sourceAccountId: srcAccountId,
          destinationAccountId: dstAccountId,
          amount: storedAmount,
          description: String(description).trim(),
          notes: notes || null,
          transactionDate: transaction_date,
          isPrivate: is_private || false,
          isBackdated: backdated,
          backdateReason: backdated ? backdate_reason?.trim() : null,
          createdBy: ctxGet(c, "user").id,
          referenceNumber: invoiceReference,
          taxType: txTaxType,
          taxRate,
          taxAmount,
          subtotal,
          payableKind: txPayableKind,
          dueDate: txDueDate,
          chequeNumber: txChequeNumber,
          pdcStatus: txPdcStatus,
          hasEwt: txHasEwt,
          ewtRate: txEwtRate,
          ewtAmount: txEwtAmount,
          clientId: client_id ?? null,
          payeeId: payee_id ?? null,
        });

        await insertVisibilityShares(dbClient, txn.id as number, {
          isPrivate: is_private,
          sharedWith: shared_with,
          sharedWithRoles: shared_with_roles,
        });

        let transferFeeTransactionId: number | null = null;
        if (parsedTransferFeeAmount != null) {
          const transferFeeTxn = await insertTransactionRow(dbClient, {
            workspaceId: ctxGet(c, "workspaceId"),
            category: "expense",
            subcategory: TRANSFER_FEE_SUBCATEGORY,
            sourceAccountId: srcAccountId,
            destinationAccountId: null,
            amount: parsedTransferFeeAmount,
            description: `Transfer fee — ${String(description).trim()}`,
            notes: null,
            transactionDate: transaction_date,
            isPrivate: is_private || false,
            isBackdated: backdated,
            backdateReason: backdated ? backdate_reason?.trim() : null,
            createdBy: ctxGet(c, "user").id,
            referenceNumber: reference_number?.trim() || null,
            taxType: "non_vat",
            taxRate: 12,
            taxAmount: 0,
            subtotal: parsedTransferFeeAmount,
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
          transferFeeTransactionId = transferFeeTxn.id as number;
          await insertVisibilityShares(dbClient, transferFeeTransactionId, {
            isPrivate: is_private,
            sharedWith: shared_with,
            sharedWithRoles: shared_with_roles,
          });
          await dbClient.query(
            `UPDATE accounts.transactions
                SET transfer_fee_transaction_id = $1
              WHERE id = $2 AND workspace_id = $3`,
            [transferFeeTransactionId, txn.id, ctxGet(c, "workspaceId")],
          );
        }

        await dbClient.query("COMMIT");
        return c.json(
          {
            ...txn,
            transfer_fee_transaction_id: transferFeeTransactionId,
            created_categories:
              parsedTransferFeeAmount != null ? [category, "expense"] : [category],
          },
          201,
        );
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        if (err instanceof ChargeValidationError) {
          return c.json({ error: err.message }, err.status as any);
        }
        console.error("[transactions] create error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  // ── Detail ────────────────────────────────────────────────────────────
  // The GET /:id detail handler lives in ./transactions-detail.ts and registers
  // here, BETWEEN Create and Edit, to preserve the exact Express match order
  // for the several '/:id' routes.
  registerTransactionDetailRoute(router, ctx);

  // ── Edit (basic fields) ──────────────────────────────────────────────────
  router.put(
    "/:id",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      const id = parseInt(String(c.req.param("id")), 10);
      if (!Number.isFinite(id)) {
        return c.json({ error: "Invalid id" }, 400);
      }
      const {
        category,
        subcategory,
        source_account_id,
        destination_account_id,
        amount,
        description,
        notes,
        transaction_date,
        reference_number,
        is_private,
        backdate_reason,
        tax_type,
        has_ewt,
        ewt_rate,
        payable_kind,
        due_date,
        cheque_number,
        pdc_status,
        payee_id,
        reason,
        transfer_fee_amount,
      } = await c.req.json() ?? {};

      // Reject an unrecognized tax_type up front so a typo doesn't silently
      // skip the apply path and leave the column untouched.
      if (tax_type !== undefined && tax_type !== null && !VALID_TAX_TYPES.includes(tax_type)) {
        return c.json({ error: `tax_type must be one of: ${VALID_TAX_TYPES.join(", ")}` }, 400);
      }
      if (
        source_account_id !== undefined &&
        source_account_id !== null &&
        (typeof source_account_id !== "number" || !Number.isFinite(source_account_id))
      ) {
        return c.json({ error: "source_account_id must be a finite number" }, 400);
      }
      if (
        destination_account_id !== undefined &&
        destination_account_id !== null &&
        (typeof destination_account_id !== "number" || !Number.isFinite(destination_account_id))
      ) {
        return c.json({ error: "destination_account_id must be a finite number" }, 400);
      }

      try {
        const existing = await pool.query(
          `SELECT ${TRANSACTION_COLS.join(", ")} FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
          [id, ctxGet(c, "workspaceId")],
        );
        if (existing.rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        const existingRow = existing.rows[0];

        const sets: string[] = [];
        const params: unknown[] = [];
        let idx = 1;
        const newCategory = category ?? existing.rows[0].category;
        if (category !== undefined) {
          if (!VALID_CATEGORIES.includes(category)) {
            return c.json({ error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` }, 400);
          }
          sets.push(`category = $${idx++}`);
          params.push(category);
        }
        if (subcategory !== undefined) {
          let validated: string | null;
          try {
            validated = await validateSubcategory(pool, newCategory, subcategory);
          } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : "Invalid subcategory" }, 400);
          }
          sets.push(`subcategory = $${idx++}`);
          params.push(validated);
        }
        if (source_account_id !== undefined) {
          sets.push(`source_account_id = $${idx++}`);
          params.push(source_account_id || null);
        }
        if (destination_account_id !== undefined) {
          sets.push(`destination_account_id = $${idx++}`);
          params.push(destination_account_id || null);
        }
        if (amount !== undefined) {
          const parsed = parseFloat(amount);
          // eslint-disable-next-line sonarjs/no-inverted-boolean-check -- !(x>0) also rejects NaN (non-numeric amount); `<=0` would let NaN through, changing validation.
          if (!(parsed > 0)) {
            return c.json({ error: "amount must be greater than 0" }, 400);
          }
          if (parsed > MAX_NUMERIC_12_2) {
            return c.json({ error: `amount must not exceed ${MAX_NUMERIC_12_2}` }, 400);
          }
          sets.push(`amount = $${idx++}`);
          params.push(parsed);
        }
        if (description !== undefined) {
          if (!String(description).trim()) {
            return c.json({ error: "description cannot be empty" }, 400);
          }
          sets.push(`description = $${idx++}`);
          params.push(String(description).trim());
        }
        if (notes !== undefined) {
          sets.push(`notes = $${idx++}`);
          params.push(notes || null);
        }
        if (transaction_date !== undefined) {
          if (!isValidIsoDate(String(transaction_date))) {
            return c.json({ error: "transaction_date must be YYYY-MM-DD" }, 400);
          }
          // Recompute the backdate posture. Flipping the date to/from today
          // must keep is_backdated + backdate_reason consistent so the detail
          // banner reflects reality after an edit.
          const backdated = isBackdated(String(transaction_date));
          const effectiveReason = backdate_reason?.trim() || reason?.trim();
          if (backdated) {
            const allowed =
              isWorkspaceElevated(c) ||
              (ctxGet(c, "permissions") ?? []).includes("transactions.backdate");
            if (!allowed) {
              return c.json({ error: "Missing permission: transactions.backdate" }, 403);
            }
            if (!effectiveReason) {
              return c.json({ error: "A reason is required when backdating" }, 400);
            }
          }
          sets.push(`transaction_date = $${idx++}`);
          params.push(transaction_date);
          sets.push(`is_backdated = $${idx++}`);
          params.push(backdated);
          sets.push(`backdate_reason = $${idx++}`);
          params.push(backdated ? effectiveReason : null);
        }
        if (reference_number !== undefined) {
          sets.push(`reference_number = $${idx++}`);
          params.push(reference_number?.trim() || null);
        }
        if (is_private !== undefined) {
          sets.push(`is_private = $${idx++}`);
          params.push(Boolean(is_private));
        }

        // Payable-specific fields. Nullable columns accept explicit null to
        // clear them when switching away from `payable`.
        const validPayableKinds = ["subscription", "utility", "rent", "loan", "tax", "other"];
        const validPdcStatuses = ["issued", "presented", "cleared", "bounced"];
        if (payable_kind !== undefined) {
          if (payable_kind !== null && !validPayableKinds.includes(payable_kind)) {
            return c.json({ error: `payable_kind must be one of: ${validPayableKinds.join(", ")}` }, 400);
          }
          sets.push(`payable_kind = $${idx++}`);
          params.push(payable_kind || null);
        }
        if (due_date !== undefined) {
          if (due_date !== null && due_date !== "") {
            if (typeof due_date !== "string" || !isValidIsoDate(due_date)) {
              return c.json({ error: "due_date must be YYYY-MM-DD" }, 400);
            }
          }
          sets.push(`due_date = $${idx++}`);
          params.push(due_date || null);
        }
        if (cheque_number !== undefined) {
          sets.push(`cheque_number = $${idx++}`);
          params.push(cheque_number?.trim() || null);
        }
        if (pdc_status !== undefined) {
          if (pdc_status !== null && !validPdcStatuses.includes(pdc_status)) {
            return c.json({ error: `pdc_status must be one of: ${validPdcStatuses.join(", ")}` }, 400);
          }
          sets.push(`pdc_status = $${idx++}`);
          params.push(pdc_status || null);
        }
        if (payee_id !== undefined) {
          if (payee_id != null && (typeof payee_id !== "number" || !Number.isFinite(payee_id))) {
            return c.json({ error: "payee_id must be a finite number" }, 400);
          }
          sets.push(`payee_id = $${idx++}`);
          params.push(payee_id ?? null);
        }

        // Tax type + derived VAT breakdown. Recompute subtotal/tax_amount from
        // the effective amount (the body's amount when present, else the row's
        // existing amount) so the books stay consistent after an edit.
        if (tax_type !== undefined && VALID_TAX_TYPES.includes(tax_type)) {
          const currentAmount =
            amount !== undefined ? parseFloat(amount) : parseFloat(String(existingRow.amount));
          let sub: number;
          let tax: number;
          if (tax_type === "vat_inclusive") {
            sub = Math.round((currentAmount / 1.12) * 100) / 100;
            tax = Math.round((currentAmount - sub) * 100) / 100;
          } else if (tax_type === "vat_exclusive") {
            sub = currentAmount;
            tax = Math.round(currentAmount * 0.12 * 100) / 100;
          } else {
            sub = currentAmount;
            tax = 0;
          }
          sets.push(`tax_type = $${idx++}`);
          params.push(tax_type);
          sets.push(`tax_amount = $${idx++}`);
          params.push(tax);
          sets.push(`subtotal = $${idx++}`);
          params.push(sub);
        }

        // EWT. Touch the columns whenever has_ewt OR ewt_rate is sent so the
        // dependent columns never hold inconsistent state.
        if (has_ewt !== undefined || ewt_rate !== undefined) {
          const flag = has_ewt === undefined ? existingRow.has_ewt : !!has_ewt;
          if (flag) {
            const incomingRate = ewt_rate !== undefined ? ewt_rate : existingRow.ewt_rate;
            const parsedRate = parseFloat(String(incomingRate));
            if (!Number.isFinite(parsedRate) || parsedRate <= 0 || parsedRate > 100) {
              return c.json({ error: "ewt_rate must be a number greater than 0 and at most 100" }, 400);
            }
            const baseAmount =
              amount !== undefined ? parseFloat(amount) : parseFloat(String(existingRow.amount));
            const computed = Math.round(baseAmount * parsedRate) / 100;
            sets.push(`has_ewt = $${idx++}`);
            params.push(true);
            sets.push(`ewt_rate = $${idx++}`);
            params.push(parsedRate);
            sets.push(`ewt_amount = $${idx++}`);
            params.push(computed);
          } else {
            sets.push(`has_ewt = $${idx++}`);
            params.push(false);
            sets.push(`ewt_rate = $${idx++}`);
            params.push(null);
            sets.push(`ewt_amount = $${idx++}`);
            params.push(null);
          }
        }
        const feeTouched = transfer_fee_amount !== undefined;
        let parsedRequestedFee: number | null = null;
        if (feeTouched && transfer_fee_amount !== null && String(transfer_fee_amount) !== "") {
          const raw = parseFloat(String(transfer_fee_amount));
          if (!Number.isFinite(raw) || raw <= 0) {
            return c.json({ error: "transfer_fee_amount must be greater than 0" }, 400);
          }
          if (raw > MAX_NUMERIC_12_2) {
            return c.json({ error: `transfer_fee_amount must not exceed ${MAX_NUMERIC_12_2}` }, 400);
          }
          parsedRequestedFee = raw;
        }

        if (sets.length === 0 && !feeTouched) {
          return c.json({ error: "No fields to update" }, 400);
        }
        if (sets.length > 0) {
          sets.push(`updated_at = NOW()`);
          sets.push(`updated_by = $${idx++}`);
          params.push(ctxGet(c, "user")?.id ?? null);
        }
        params.push(id, ctxGet(c, "workspaceId"));

        let dbClient: import("pg").PoolClient | null = null;
        try {
          dbClient = await pool.connect();
          await dbClient.query("BEGIN");
          await applyTenantContext(dbClient);

          // Cross-tenant guard: an edit reassigning source/destination to
          // another workspace's account must fail before the UPDATE runs.
          if (source_account_id !== undefined && source_account_id != null) {
            await assertOrgOwnsRow(dbClient, "accounts.financial_accounts", source_account_id, ctxGet(c, "workspaceId"), "source_account_id");
          }
          if (destination_account_id !== undefined && destination_account_id != null) {
            await assertOrgOwnsRow(dbClient, "accounts.financial_accounts", destination_account_id, ctxGet(c, "workspaceId"), "destination_account_id");
          }

          const result = sets.length > 0
            ? await dbClient.query(
                `UPDATE accounts.transactions SET ${sets.join(", ")} WHERE id = $${idx++} AND workspace_id = $${idx} RETURNING ${TRANSACTION_COLS.join(", ")}`,
                params,
              )
            : await dbClient.query(
                `SELECT ${TRANSACTION_COLS.join(", ")} FROM accounts.transactions WHERE id = $${idx++} AND workspace_id = $${idx}`,
                params,
              );
          if (feeTouched) {
            const updatedRow = result.rows[0];
            const rawDate = updatedRow.transaction_date;
            // pg's default DATE parser returns midnight in the process's LOCAL zone.
            // toISOString() shifts to UTC and can roll to the prior day when the
            // process is in a non-UTC zone (e.g. PHT +8), silently backdating the
            // synced fee row. Use local Y/M/D components to preserve the stored date.
            const isoDate = ((): string => {
              if (rawDate instanceof Date) {
                const y = rawDate.getFullYear();
                const m = String(rawDate.getMonth() + 1).padStart(2, "0");
                const d = String(rawDate.getDate()).padStart(2, "0");
                return `${y}-${m}-${d}`;
              }
              return String(rawDate).slice(0, 10);
            })();
            const feeSync = await syncTransferFee(dbClient, {
              transferId: id,
              workspaceId: ctxGet(c, "workspaceId"),
              userId: ctxGet(c, "user")?.id ?? "",
              effectiveCategory: updatedRow.category,
              effectiveDescription: String(updatedRow.description ?? ""),
              effectiveSourceAccountId: updatedRow.source_account_id ?? null,
              effectiveTransactionDate: isoDate,
              effectiveIsPrivate: !!updatedRow.is_private,
              effectiveIsBackdated: !!updatedRow.is_backdated,
              effectiveBackdateReason: updatedRow.backdate_reason ?? null,
              existingFeeId: (existingRow.transfer_fee_transaction_id as number | null) ?? null,
              requestedFeeAmount: parsedRequestedFee,
            });
            if (!feeSync.ok) {
              await dbClient.query("ROLLBACK");
              return c.json({ error: feeSync.error }, feeSync.status);
            }
          }
          // Append an audit row when a reason is supplied.
          if (reason && String(reason).trim()) {
            await dbClient.query(
              `INSERT INTO accounts.transaction_edits (transaction_id, workspace_id, edited_by, reason, kind)
                 VALUES ($1, $2, $3, $4, 'edit')`,
              [id, ctxGet(c, "workspaceId"), ctxGet(c, "user")?.id ?? "", String(reason).trim()],
            );
          }
          await dbClient.query("COMMIT");
          const updated = result.rows[0];
          // Enrich response with payee name and user names.
          let payee: string | null = null;
          if (updated.payee_id != null) {
            const payees = await findPayeesByIds(pool, [updated.payee_id], ctxGet(c, "workspaceId"));
            payee = payees[0]?.name ?? null;
          }
          const updUserIds = new Set<string>();
          if (updated.created_by) updUserIds.add(updated.created_by);
          if (updated.updated_by) updUserIds.add(updated.updated_by);
          const updUserMap = await resolveUserNames(pool, updUserIds);
          const updCreatedBy = updated.created_by ? updUserMap.get(updated.created_by) : undefined;
          const updUpdatedBy = updated.updated_by ? updUserMap.get(updated.updated_by) : undefined;
          return c.json({ ...updated, payee, created_by_name: updCreatedBy?.name ?? null, created_by_image: updCreatedBy?.image ?? null, updated_by_name: updUpdatedBy?.name ?? null, updated_by_image: updUpdatedBy?.image ?? null });
        } catch (err) {
          if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          if (dbClient) dbClient.release();
        }
      } catch (err) {
        if (err instanceof ChargeValidationError) {
          return c.json({ error: err.message }, err.status as any);
        }
        console.error("[transactions] update error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  // ── Status + share-grant cluster ─────────────────────────────────────────
  // DELETE /:id, POST /:id/void, POST /:id/unvoid, PUT /:id/visibility,
  // GET /:id/line-items, POST /:id/line-items/:lineItemId/void live in
  // ./transactions-status.ts and register here last (after Edit), reproducing
  // the original tail order of these handlers.
  registerTransactionStatusRoutes(router, ctx);
  registerTransactionCartEditRoute(router, ctx);
}

// The three counter PATCH routes live in ./transactions-counter-patch.ts and
// register in their original position AFTER the attachment routes (preserving
// the exact Express match order). Re-exported here so routes.ts keeps importing
// registerCounterPatchRoutes from this module with no signature change.
export { registerCounterPatchRoutes } from "./transactions-counter-patch.js";
