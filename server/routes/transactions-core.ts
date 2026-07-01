// Core transaction CRUD routes for the transactions router.
//
// registerCoreRoutes mounts: GET / (list with pagination/sort/filters/search),
// POST / (create), GET /:id (detail), PUT /:id (edit basic fields),
// DELETE /:id (soft-delete → status='voided'), POST /:id/void, POST /:id/unvoid,
// PUT /:id/visibility (replace per-user/per-role share grants),
// GET /:id/line-items, and POST /:id/line-items/:lineItemId/void.
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
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { identityHeaderOf } from "@kahitsan/plugin-sdk";
import { findAccountsByIds, findPayeesByIds } from "../lib/peers.js";
import { validateSubcategory } from "../lib/transaction-subcategories.js";
import { isBackdated } from "../lib/backdate.js";
import { registerTransactionDetailRoute } from "./transactions-detail.js";
import { registerTransactionStatusRoutes } from "./transactions-status.js";
import { ctxGet } from "../types.js";
import {
  SORTABLE_COLUMNS,
  VALID_CATEGORIES,
  VALID_STATUSES,
  VALID_TAX_TYPES,
  isValidIsoDate,
  escapeLike,
  resolveUserNames,
  privacyClause,
} from "./shared.js";

export type CoreRouteCtx = {
  pool: PluginDb;
  requireAuth: MiddlewareHandler;
  requireWorkspace: MiddlewareHandler;
  requirePermission: (...codes: string[]) => MiddlewareHandler;
};

export function registerCoreRoutes(router: Hono, ctx: CoreRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  // ── List ────────────────────────────────────────────────────────────────
  router.get(
    "/",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c) => {
      const search = (c.req.query("search") as string | undefined)?.trim();
      const category = c.req.query("category") as string | undefined;
      const subcategory = c.req.query("subcategory") as string | undefined;
      const status = c.req.query("status") as string | undefined;
      const accountId = c.req.query("accountId") as string | undefined;
      const createdBy = c.req.query("createdBy") as string | undefined;
      const dateFrom = c.req.query("dateFrom") as string | undefined;
      const dateTo = c.req.query("dateTo") as string | undefined;
      const sortBy = c.req.query("sortBy") as string | undefined;
      const sortDir = (c.req.query("sortDir") as string)?.toUpperCase() === "ASC" ? "ASC" : "DESC";
      const page = Math.max(1, parseInt(c.req.query("page") as string) || 1);
      const limit = Math.min(parseInt(c.req.query("limit") as string) || 25, 200);
      const offset = (page - 1) * limit;

      try {
        const conditions: string[] = ["t.workspace_id = $1"];
        const params: unknown[] = [ctxGet(c, "workspaceId")];
        let idx = 2;

        const priv = privacyClause(c, params, idx);
        if (priv) {
          conditions.push(priv);
          idx += 2;
        }

        if (category) {
          const cats = category.split(",").filter((c) => VALID_CATEGORIES.includes(c));
          if (cats.length === 1) {
            conditions.push(`t.category = $${idx++}`);
            params.push(cats[0]);
          } else if (cats.length > 1 && cats.length < VALID_CATEGORIES.length) {
            conditions.push(`t.category = ANY($${idx++})`);
            params.push(cats);
          }
        }

        if (subcategory && subcategory.trim() !== "") {
          const parts = subcategory.split(",").map((p) => p.trim()).filter(Boolean);
          if (parts.length === 1) {
            conditions.push(`t.subcategory = $${idx++}`);
            params.push(parts[0]);
          } else if (parts.length > 1) {
            conditions.push(`t.subcategory = ANY($${idx++})`);
            params.push(parts);
          }
        }

        if (status && VALID_STATUSES.includes(status)) {
          conditions.push(`t.status = $${idx++}`);
          params.push(status);
        } else if (!status || status === "" || status === "active") {
          conditions.push(`t.status != 'voided'`);
        }

        if (accountId) {
          const aid = parseInt(accountId);
          if (!isNaN(aid)) {
            conditions.push(
              `(t.source_account_id = $${idx} OR t.destination_account_id = $${idx} OR EXISTS (SELECT 1 FROM accounts.transaction_payments tp WHERE tp.transaction_id = t.id AND tp.financial_account_id = $${idx}))`,
            );
            params.push(aid);
            idx++;
          }
        }

        if (createdBy && createdBy.trim() !== "") {
          conditions.push(`t.created_by = $${idx++}`);
          params.push(createdBy.trim());
        }
        if (dateFrom) {
          conditions.push(`t.transaction_date >= $${idx++}`);
          params.push(dateFrom);
        }
        if (dateTo) {
          conditions.push(`t.transaction_date <= $${idx++}`);
          params.push(dateTo);
        }
        if (search) {
          conditions.push(`(t.description ILIKE $${idx} ESCAPE '\\' OR t.notes ILIKE $${idx} ESCAPE '\\')`);
          params.push(`%${escapeLike(search)}%`);
          idx++;
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;
        const sortColumn = SORTABLE_COLUMNS.includes(sortBy || "") ? sortBy : "transaction_date";
        const orderClause = `ORDER BY t.${sortColumn} ${sortDir}, t.id DESC`;

        const dataQuery = `
          SELECT t.*,
            to_char(t.transaction_date, 'YYYY-MM-DD') AS transaction_date,
            (SELECT COUNT(*) FROM accounts.transaction_attachments ta WHERE ta.transaction_id = t.id) AS attachment_count,
            paid.total_paid::numeric(12,2) AS amount_collected,
            (t.amount - paid.total_paid)::numeric(12,2) AS balance,
            CASE
              WHEN t.category != 'sale' THEN NULL
              WHEN t.status = 'voided' THEN 'voided'
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
          ${whereClause}
          ${orderClause}
          LIMIT $${idx++} OFFSET $${idx++}`;
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
          ? new Map((await findPayeesByIds(payeeIds, idh))?.map((p: { id: number; name: string }) => [p.id, p.name]) ?? [])
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
        const isAdmin = ctxGet(c, "user")?.role === "superuser" || ctxGet(c, "wsRole") === "admin";
        const allowed = isAdmin || (ctxGet(c, "permissions") ?? []).includes("transactions.backdate");
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
        const txn = await insertTransactionRow(dbClient, {
          workspaceId: ctxGet(c, "workspaceId"),
          category,
          subcategory: validatedSubcategory,
          sourceAccountId: source_account_id || null,
          destinationAccountId: destination_account_id || null,
          amount: storedAmount,
          description: String(description).trim(),
          notes: notes || null,
          transactionDate: transaction_date,
          isPrivate: is_private || false,
          isBackdated: backdated,
          backdateReason: backdated ? backdate_reason?.trim() : null,
          createdBy: ctxGet(c, "user").id,
          referenceNumber: reference_number?.trim() || null,
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

        await dbClient.query("COMMIT");
        return c.json(txn, 201);
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
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
      } = await c.req.json() ?? {};

      // Reject an unrecognized tax_type up front so a typo doesn't silently
      // skip the apply path and leave the column untouched.
      if (tax_type !== undefined && tax_type !== null && !VALID_TAX_TYPES.includes(tax_type)) {
        return c.json({ error: `tax_type must be one of: ${VALID_TAX_TYPES.join(", ")}` }, 400);
      }

      try {
        const existing = await pool.query(
          `SELECT * FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
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
            const isAdmin = ctxGet(c, "user")?.role === "superuser" || ctxGet(c, "wsRole") === "admin";
            const allowed = isAdmin || (ctxGet(c, "permissions") ?? []).includes("transactions.backdate");
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
        if (sets.length === 0) {
          return c.json({ error: "No fields to update" }, 400);
        }
        sets.push(`updated_at = NOW()`);
        sets.push(`updated_by = $${idx++}`);
        params.push(ctxGet(c, "user")?.id ?? null);
        params.push(id, ctxGet(c, "workspaceId"));

        let dbClient: import("pg").PoolClient | null = null;
        try {
          dbClient = await pool.connect();
          await dbClient.query("BEGIN");
          await applyTenantContext(dbClient);
          const result = await dbClient.query(
            `UPDATE accounts.transactions SET ${sets.join(", ")} WHERE id = $${idx++} AND workspace_id = $${idx} RETURNING *`,
            params,
          );
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
            const payees = await findPayeesByIds([updated.payee_id], identityHeaderOf(c));
            payee = payees?.[0]?.name ?? null;
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
}

// The three counter PATCH routes live in ./transactions-counter-patch.ts and
// register in their original position AFTER the attachment routes (preserving
// the exact Express match order). Re-exported here so routes.ts keeps importing
// registerCounterPatchRoutes from this module with no signature change.
export { registerCounterPatchRoutes } from "./transactions-counter-patch.js";
