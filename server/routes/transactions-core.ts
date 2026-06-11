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
// AND organization_id = $N org scoping, the ends_at recompute CASE (hour/day/
// month intervals), the both-sides tenant delete in visibility, the natural-day
// posture, and all BEGIN/COMMIT/ROLLBACK unchanged. Cross-plugin data
// (package/variant/client/payee names, voucher discount) is resolved over the
// kernel RPC (lib/peers.ts) with graceful degradation.

import { type Router, type Request, type Response, type RequestHandler } from "express";
import { tenant, readIdentity, applyTenantContext } from "@ks-erp/kernel-base";
import type { PluginDb } from "@ks-erp/kernel/services/database";
import { identityHeaderOf } from "@ks-erp/kernel/service-rpc";
import {
  findPackagesByIds,
  findVariantsByIds,
  findClientsByIds,
  findPayeesByIds,
} from "../lib/peers.js";
import { validateSubcategory } from "../lib/transaction-subcategories.js";
import { isBackdated } from "../lib/backdate.js";
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
  requireAuth: RequestHandler;
  requireOrg: RequestHandler;
  requirePermission: (...codes: string[]) => RequestHandler;
};

export function registerCoreRoutes(router: Router, ctx: CoreRouteCtx): void {
  const { pool, requireAuth, requireOrg, requirePermission } = ctx;

  // ── List ────────────────────────────────────────────────────────────────
  router.get(
    "/",
    requireAuth,
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      const search = (req.query.search as string | undefined)?.trim();
      const category = req.query.category as string | undefined;
      const subcategory = req.query.subcategory as string | undefined;
      const status = req.query.status as string | undefined;
      const accountId = req.query.accountId as string | undefined;
      const createdBy = req.query.createdBy as string | undefined;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const sortBy = req.query.sortBy as string | undefined;
      const sortDir = (req.query.sortDir as string)?.toUpperCase() === "ASC" ? "ASC" : "DESC";
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 200);
      const offset = (page - 1) * limit;

      try {
        const conditions: string[] = ["t.organization_id = $1"];
        const params: unknown[] = [req.organizationId];
        let idx = 2;

        const priv = privacyClause(req, params, idx);
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

        // Enrich with payee names and user names.
        const idh = identityHeaderOf(req);
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
        for (const row of result.rows) {
          row.payee = row.payee_id != null ? (payeeMap.get(row.payee_id) ?? null) : null;
          const cUser = row.created_by ? userMap.get(row.created_by) : undefined;
          const uUser = row.updated_by ? userMap.get(row.updated_by) : undefined;
          row.created_by_name = cUser?.name ?? null;
          row.created_by_image = cUser?.image ?? null;
          row.updated_by_name = uUser?.name ?? null;
          row.updated_by_image = uUser?.image ?? null;
        }

        res.json({ data: result.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
      } catch (err) {
        console.error("[transactions] list error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ── Create (manual income/expense/business) ─────────────────────────────
  router.post(
    "/",
    requireAuth,
    requireOrg,
    requirePermission("transactions.create"),
    async (req: Request, res: Response) => {
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
      } = req.body ?? {};

      if (!category || !VALID_CATEGORIES.includes(category)) {
        res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` });
        return;
      }
      if (client_id != null && (typeof client_id !== "number" || !Number.isFinite(client_id))) {
        res.status(400).json({ error: "client_id must be a finite number" });
        return;
      }
      if (payee_id != null && (typeof payee_id !== "number" || !Number.isFinite(payee_id))) {
        res.status(400).json({ error: "payee_id must be a finite number" });
        return;
      }

      let validatedSubcategory: string | null;
      try {
        validatedSubcategory = await validateSubcategory(pool, category, subcategory);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Invalid subcategory" });
        return;
      }

      const parsedAmount = parseFloat(amount);
      // eslint-disable-next-line sonarjs/no-inverted-boolean-check -- !(x>0) also rejects NaN (non-numeric amount); `<=0` would let NaN through, changing validation.
      if (!amount || !(parsedAmount > 0)) {
        res.status(400).json({ error: "amount must be greater than 0" });
        return;
      }
      if (!description || !String(description).trim()) {
        res.status(400).json({ error: "description is required" });
        return;
      }
      if (!transaction_date || !isValidIsoDate(String(transaction_date))) {
        res.status(400).json({ error: "transaction_date must be YYYY-MM-DD" });
        return;
      }
      if (!req.organizationId || !req.user?.id) {
        res.status(400).json({ error: "Organization and user context required" });
        return;
      }

      // Backdate gate (transactions.backdate). Admin/superuser bypass.
      const backdated = isBackdated(String(transaction_date));
      if (backdated) {
        const isAdmin = req.user?.role === "superuser" || req.orgRole === "admin";
        const allowed = isAdmin || (req.permissions ?? []).includes("transactions.backdate");
        if (!allowed) {
          res.status(403).json({ error: "Missing permission: transactions.backdate" });
          return;
        }
        if (!backdate_reason?.trim()) {
          res.status(400).json({ error: "backdate_reason is required when backdating" });
          return;
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
          res.status(400).json({ error: `payable_kind must be one of: ${validPayableKinds.join(", ")}` });
          return;
        }
        txPayableKind = payable_kind;
        if (due_date) {
          if (typeof due_date !== "string" || !isValidIsoDate(due_date)) {
            res.status(400).json({ error: "due_date must be YYYY-MM-DD" });
            return;
          }
          txDueDate = due_date;
        }
        txChequeNumber = cheque_number?.trim() || null;
        if (txChequeNumber && pdc_status && !validPdcStatuses.includes(pdc_status)) {
          res.status(400).json({ error: `pdc_status must be one of: ${validPdcStatuses.join(", ")}` });
          return;
        }
        txPdcStatus = txChequeNumber ? pdc_status || "issued" : null;
      }

      // VAT computation.
      if (tax_type != null && !VALID_TAX_TYPES.includes(tax_type)) {
        res.status(400).json({ error: `tax_type must be one of: ${VALID_TAX_TYPES.join(", ")}` });
        return;
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
          res.status(400).json({ error: "ewt_rate must be a number greater than 0 and at most 100" });
          return;
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
        const result = await dbClient.query(
          `INSERT INTO accounts.transactions
             (organization_id, category, subcategory, source_account_id, destination_account_id,
              amount, description, notes, transaction_date, is_private, is_backdated, backdate_reason,
              created_by, updated_by, reference_number, tax_type, tax_rate, tax_amount, subtotal,
              payable_kind, due_date, cheque_number, pdc_status, has_ewt, ewt_rate, ewt_amount, client_id,
              payee_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14, $15, $16, $17, $18,
                   $19, $20, $21, $22, $23, $24, $25, $26, $27)
           RETURNING *`,
          [
            req.organizationId,
            category,
            validatedSubcategory,
            source_account_id || null,
            destination_account_id || null,
            storedAmount,
            String(description).trim(),
            notes || null,
            transaction_date,
            is_private || false,
            backdated,
            backdated ? backdate_reason?.trim() : null,
            req.user.id,
            reference_number?.trim() || null,
            txTaxType,
            taxRate,
            taxAmount,
            subtotal,
            txPayableKind,
            txDueDate,
            txChequeNumber,
            txPdcStatus,
            txHasEwt,
            txEwtRate,
            txEwtAmount,
            client_id ?? null,
            payee_id ?? null,
          ],
        );
        const txn = result.rows[0];

        if (is_private && Array.isArray(shared_with) && shared_with.length > 0) {
          const values = shared_with.map((_: string, i: number) => `($1, $${i + 2})`).join(", ");
          await dbClient.query(
            `INSERT INTO accounts.transaction_visibility (transaction_id, user_id) VALUES ${values}
               ON CONFLICT (transaction_id, user_id) DO NOTHING`,
            [txn.id, ...shared_with],
          );
        }
        if (is_private && Array.isArray(shared_with_roles) && shared_with_roles.length > 0) {
          const values = shared_with_roles.map((_: string, i: number) => `($1, $${i + 2})`).join(", ");
          await dbClient.query(
            `INSERT INTO accounts.transaction_visibility_role (transaction_id, role_code) VALUES ${values}
               ON CONFLICT (transaction_id, role_code) DO NOTHING`,
            [txn.id, ...shared_with_roles],
          );
        }

        await dbClient.query("COMMIT");
        res.status(201).json(txn);
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] create error:", err);
        res.status(500).json({ error: "Internal server error" });
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  // ── Detail ────────────────────────────────────────────────────────────
  router.get(
    "/:id",
    requireAuth,
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT t.*,
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
          WHERE t.id = $1 AND t.organization_id = $2`,
          [req.params.id, req.organizationId],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        const txn = result.rows[0];
        const idh = identityHeaderOf(req);

        // Privacy check.
        const isAdmin = req.orgRole === "admin" || req.user?.role === "superuser";
        if (txn.is_private && txn.created_by !== req.user?.id && !isAdmin) {
          const vis = await pool.query(
            `SELECT 1 FROM accounts.transaction_visibility WHERE transaction_id = $1 AND user_id = $2
             UNION ALL
             SELECT 1 FROM accounts.transaction_visibility_role WHERE transaction_id = $1 AND role_code = $3
             LIMIT 1`,
            [txn.id, req.user?.id, req.orgRole ?? ""],
          );
          if (vis.rows.length === 0) {
            res.status(404).json({ error: "Not found" });
            return;
          }
        }

        const attachments = await pool.query(
          `SELECT id, transaction_id, file_name, file_size, mime_type, uploaded_by, s3_link, created_at
             FROM accounts.transaction_attachments WHERE transaction_id = $1 ORDER BY created_at`,
          [txn.id],
        );

        let shared_with: { user_id: string }[] = [];
        let shared_with_roles: { role_code: string }[] = [];
        if (txn.is_private && (txn.created_by === req.user?.id || isAdmin)) {
          shared_with = (
            await pool.query(`SELECT user_id FROM accounts.transaction_visibility WHERE transaction_id = $1`, [txn.id])
          ).rows;
          shared_with_roles = (
            await pool.query(`SELECT role_code FROM accounts.transaction_visibility_role WHERE transaction_id = $1`, [txn.id])
          ).rows;
        }

        const lineItemsResult = await pool.query(
          `SELECT id, package_id, package_variant_id, description, quantity, unit_price,
                  duration_value, duration_unit, started_at, ends_at, status, client_id, customer_group_id
             FROM accounts.transaction_line_items
            WHERE transaction_id = $1 AND organization_id = $2
            ORDER BY id ASC`,
          [txn.id, req.organizationId],
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
              WHERE transaction_id = $1 AND organization_id = $2
              ORDER BY edited_at DESC`,
            [txn.id, req.organizationId],
          )
        ).rows;

        const payments = (
          await pool.query(
            `SELECT id, financial_account_id, amount, notes, created_at, customer_group_id
               FROM accounts.transaction_payments
              WHERE transaction_id = $1 AND organization_id = $2
              ORDER BY created_at ASC, id ASC`,
            [txn.id, req.organizationId],
          )
        ).rows;

        const customerGroups = (
          await pool.query(
            `SELECT id, position, client_id, display_name, note, voucher_id, subtotal, discount_amount, is_payer
               FROM accounts.transaction_customer_groups
              WHERE transaction_id = $1 AND organization_id = $2
              ORDER BY position ASC`,
            [txn.id, req.organizationId],
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
        const customer_groups = customerGroups.map((g) => ({
          ...g,
          client_name: g.client_id != null ? (cgClientName.get(g.client_id) ?? null) : null,
          display_name: g.client_id != null ? (cgClientName.get(g.client_id) ?? g.display_name) : (g.display_name ?? null),
        }));

        const clientPoolRows = (
          await pool.query(
            `SELECT client_id, position FROM accounts.transaction_customers
              WHERE transaction_id = $1 AND organization_id = $2 ORDER BY position ASC, client_id ASC`,
            [txn.id, req.organizationId],
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
          const payees = await findPayeesByIds([txn.payee_id], idh);
          payee = payees?.[0]?.name ?? null;
        }

        // Resolve user names (created_by / updated_by).
        const userIds = new Set<string>();
        if (txn.created_by) userIds.add(txn.created_by);
        if (txn.updated_by) userIds.add(txn.updated_by);
        const userMap = await resolveUserNames(pool, userIds);
        const createdByUser = txn.created_by ? userMap.get(txn.created_by) : undefined;
        const updatedByUser = txn.updated_by ? userMap.get(txn.updated_by) : undefined;

        res.json({
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
          payments,
        });
      } catch (err) {
        console.error("[transactions] get error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ── Edit (basic fields) ──────────────────────────────────────────────────
  router.put(
    "/:id",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
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
      } = req.body ?? {};

      // Reject an unrecognized tax_type up front so a typo doesn't silently
      // skip the apply path and leave the column untouched.
      if (tax_type !== undefined && tax_type !== null && !VALID_TAX_TYPES.includes(tax_type)) {
        res.status(400).json({ error: `tax_type must be one of: ${VALID_TAX_TYPES.join(", ")}` });
        return;
      }

      try {
        const existing = await pool.query(
          `SELECT * FROM accounts.transactions WHERE id = $1 AND organization_id = $2`,
          [id, req.organizationId],
        );
        if (existing.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        const existingRow = existing.rows[0];

        const sets: string[] = [];
        const params: unknown[] = [];
        let idx = 1;
        const newCategory = category ?? existing.rows[0].category;
        if (category !== undefined) {
          if (!VALID_CATEGORIES.includes(category)) {
            res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` });
            return;
          }
          sets.push(`category = $${idx++}`);
          params.push(category);
        }
        if (subcategory !== undefined) {
          let validated: string | null;
          try {
            validated = await validateSubcategory(pool, newCategory, subcategory);
          } catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : "Invalid subcategory" });
            return;
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
            res.status(400).json({ error: "amount must be greater than 0" });
            return;
          }
          sets.push(`amount = $${idx++}`);
          params.push(parsed);
        }
        if (description !== undefined) {
          if (!String(description).trim()) {
            res.status(400).json({ error: "description cannot be empty" });
            return;
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
            res.status(400).json({ error: "transaction_date must be YYYY-MM-DD" });
            return;
          }
          // Recompute the backdate posture. Flipping the date to/from today
          // must keep is_backdated + backdate_reason consistent so the detail
          // banner reflects reality after an edit.
          const backdated = isBackdated(String(transaction_date));
          const effectiveReason = backdate_reason?.trim() || reason?.trim();
          if (backdated) {
            const isAdmin = req.user?.role === "superuser" || req.orgRole === "admin";
            const allowed = isAdmin || (req.permissions ?? []).includes("transactions.backdate");
            if (!allowed) {
              res.status(403).json({ error: "Missing permission: transactions.backdate" });
              return;
            }
            if (!effectiveReason) {
              res.status(400).json({ error: "A reason is required when backdating" });
              return;
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
            res.status(400).json({ error: `payable_kind must be one of: ${validPayableKinds.join(", ")}` });
            return;
          }
          sets.push(`payable_kind = $${idx++}`);
          params.push(payable_kind || null);
        }
        if (due_date !== undefined) {
          if (due_date !== null && due_date !== "") {
            if (typeof due_date !== "string" || !isValidIsoDate(due_date)) {
              res.status(400).json({ error: "due_date must be YYYY-MM-DD" });
              return;
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
            res.status(400).json({ error: `pdc_status must be one of: ${validPdcStatuses.join(", ")}` });
            return;
          }
          sets.push(`pdc_status = $${idx++}`);
          params.push(pdc_status || null);
        }
        if (payee_id !== undefined) {
          if (payee_id != null && (typeof payee_id !== "number" || !Number.isFinite(payee_id))) {
            res.status(400).json({ error: "payee_id must be a finite number" });
            return;
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
              res.status(400).json({ error: "ewt_rate must be a number greater than 0 and at most 100" });
              return;
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
          res.status(400).json({ error: "No fields to update" });
          return;
        }
        sets.push(`updated_at = NOW()`);
        sets.push(`updated_by = $${idx++}`);
        params.push(req.user?.id ?? null);
        params.push(id, req.organizationId);

        let dbClient: import("pg").PoolClient | null = null;
        try {
          dbClient = await pool.connect();
          await dbClient.query("BEGIN");
          await applyTenantContext(dbClient);
          const result = await dbClient.query(
            `UPDATE accounts.transactions SET ${sets.join(", ")} WHERE id = $${idx++} AND organization_id = $${idx} RETURNING *`,
            params,
          );
          // Append an audit row when a reason is supplied.
          if (reason && String(reason).trim()) {
            await dbClient.query(
              `INSERT INTO accounts.transaction_edits (transaction_id, organization_id, edited_by, reason, kind)
                 VALUES ($1, $2, $3, $4, 'edit')`,
              [id, req.organizationId, req.user?.id ?? "", String(reason).trim()],
            );
          }
          await dbClient.query("COMMIT");
          const updated = result.rows[0];
          // Enrich response with payee name and user names.
          let payee: string | null = null;
          if (updated.payee_id != null) {
            const payees = await findPayeesByIds([updated.payee_id], identityHeaderOf(req));
            payee = payees?.[0]?.name ?? null;
          }
          const updUserIds = new Set<string>();
          if (updated.created_by) updUserIds.add(updated.created_by);
          if (updated.updated_by) updUserIds.add(updated.updated_by);
          const updUserMap = await resolveUserNames(pool, updUserIds);
          const updCreatedBy = updated.created_by ? updUserMap.get(updated.created_by) : undefined;
          const updUpdatedBy = updated.updated_by ? updUserMap.get(updated.updated_by) : undefined;
          res.json({ ...updated, payee, created_by_name: updCreatedBy?.name ?? null, created_by_image: updCreatedBy?.image ?? null, updated_by_name: updUpdatedBy?.name ?? null, updated_by_image: updUpdatedBy?.image ?? null });
        } catch (err) {
          if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          if (dbClient) dbClient.release();
        }
      } catch (err) {
        console.error("[transactions] update error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ── Soft-delete (void) ───────────────────────────────────────────────────
  router.delete(
    "/:id",
    requireAuth,
    requireOrg,
    requirePermission("transactions.delete"),
    async (req: Request, res: Response) => {
      try {
        const result = await pool.query(
          `UPDATE accounts.transactions SET status = 'voided', updated_at = NOW(), updated_by = $3
             WHERE id = $1 AND organization_id = $2 AND status != 'voided' RETURNING id`,
          [req.params.id, req.organizationId, req.user?.id ?? null],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Not found or already voided" });
          return;
        }
        res.status(204).send();
      } catch (err) {
        console.error("[transactions] delete error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ── Void / unvoid with audit ─────────────────────────────────────────────
  router.post(
    "/:id/void",
    requireAuth,
    requireOrg,
    requirePermission("transactions.delete"),
    async (req: Request, res: Response) => {
      const { reason } = req.body ?? {};
      if (!reason || !String(reason).trim()) {
        res.status(400).json({ error: "reason is required" });
        return;
      }
      let dbClient: import("pg").PoolClient | null = null;
      try {
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        const result = await dbClient.query(
          `UPDATE accounts.transactions SET status = 'voided', updated_at = NOW(), updated_by = $3
             WHERE id = $1 AND organization_id = $2 AND status != 'voided' RETURNING *`,
          [req.params.id, req.organizationId, req.user?.id ?? null],
        );
        if (result.rows.length === 0) {
          await dbClient.query("ROLLBACK");
          res.status(404).json({ error: "Not found or already voided" });
          return;
        }
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, organization_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'void')`,
          [req.params.id, req.organizationId, req.user?.id ?? "", String(reason).trim()],
        );
        await dbClient.query("COMMIT");
        res.json(result.rows[0]);
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] void error:", err);
        res.status(500).json({ error: "Internal server error" });
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  router.post(
    "/:id/unvoid",
    requireAuth,
    requireOrg,
    requirePermission("transactions.delete"),
    async (req: Request, res: Response) => {
      const { reason } = req.body ?? {};
      if (!reason || !String(reason).trim()) {
        res.status(400).json({ error: "reason is required" });
        return;
      }
      let dbClient: import("pg").PoolClient | null = null;
      try {
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        const result = await dbClient.query(
          `UPDATE accounts.transactions SET status = 'completed', updated_at = NOW(), updated_by = $3
             WHERE id = $1 AND organization_id = $2 AND status = 'voided' RETURNING *`,
          [req.params.id, req.organizationId, req.user?.id ?? null],
        );
        if (result.rows.length === 0) {
          await dbClient.query("ROLLBACK");
          res.status(404).json({ error: "Not found or not voided" });
          return;
        }
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, organization_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'unvoid')`,
          [req.params.id, req.organizationId, req.user?.id ?? "", String(reason).trim()],
        );
        await dbClient.query("COMMIT");
        res.json(result.rows[0]);
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] unvoid error:", err);
        res.status(500).json({ error: "Internal server error" });
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  // ── Visibility grants ─────────────────────────────────────────────────────
  router.put(
    "/:id/visibility",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const { is_private, shared_with, shared_with_roles } = req.body ?? {};
      let dbClient: import("pg").PoolClient | null = null;
      try {
        const exists = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND organization_id = $2`,
          [req.params.id, req.organizationId],
        );
        if (exists.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        const identity = readIdentity(req);
        if (!identity) {
          res.status(401).json({ error: "Not authenticated" });
          return;
        }
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        await dbClient.query(
          `UPDATE accounts.transactions SET is_private = $3, updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
          [req.params.id, req.organizationId, Boolean(is_private)],
        );
        // Child tables have no organization_id column; route both deletes
        // through the org-scoped tenant handle (same pinned client, inside the
        // BEGIN/COMMIT) so it compiles a both-sides subquery against the FK
        // parent accounts.transactions and the delete can't cross tenants.
        await tenant(dbClient, identity).delete("transaction_visibility", {
          where: "transaction_id = $1",
          params: [req.params.id],
        });
        await tenant(dbClient, identity).delete("transaction_visibility_role", {
          where: "transaction_id = $1",
          params: [req.params.id],
        });
        if (is_private && Array.isArray(shared_with) && shared_with.length > 0) {
          const values = shared_with.map((_: string, i: number) => `($1, $${i + 2})`).join(", ");
          await dbClient.query(
            `INSERT INTO accounts.transaction_visibility (transaction_id, user_id) VALUES ${values}
               ON CONFLICT (transaction_id, user_id) DO NOTHING`,
            [req.params.id, ...shared_with],
          );
        }
        if (is_private && Array.isArray(shared_with_roles) && shared_with_roles.length > 0) {
          const values = shared_with_roles.map((_: string, i: number) => `($1, $${i + 2})`).join(", ");
          await dbClient.query(
            `INSERT INTO accounts.transaction_visibility_role (transaction_id, role_code) VALUES ${values}
               ON CONFLICT (transaction_id, role_code) DO NOTHING`,
            [req.params.id, ...shared_with_roles],
          );
        }
        await dbClient.query("COMMIT");
        res.json({ ok: true });
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] visibility error:", err);
        res.status(500).json({ error: "Internal server error" });
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  // ── Line items (formerly /api/transaction-line-items) ────────────────────
  router.get(
    "/:id/line-items",
    requireAuth,
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const rows = await pool.query(
          `SELECT id, package_id, package_variant_id, description, quantity, unit_price,
                  duration_value, duration_unit, started_at, ends_at, status, client_id, customer_group_id
             FROM accounts.transaction_line_items
            WHERE transaction_id = $1 AND organization_id = $2 ORDER BY id ASC`,
          [req.params.id, req.organizationId],
        );
        res.json({ line_items: rows.rows });
      } catch (err) {
        console.error("[transactions] line-items list error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.post(
    "/:id/line-items/:lineItemId/void",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      try {
        const result = await pool.query(
          `UPDATE accounts.transaction_line_items SET status = 'voided', updated_at = NOW()
             WHERE id = $1 AND transaction_id = $2 AND organization_id = $3 AND status != 'voided' RETURNING *`,
          [req.params.lineItemId, req.params.id, req.organizationId],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Not found or already voided" });
          return;
        }
        res.json(result.rows[0]);
      } catch (err) {
        console.error("[transactions] line-item void error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );
}

// The three counter PATCH routes — kept in a separate function so they register
// in their original position AFTER the attachment routes, preserving the exact
// Express match order. The ends_at recompute CASE (hour/day/month intervals)
// and the payer-group EXISTS sync are unchanged.
export function registerCounterPatchRoutes(router: Router, ctx: CoreRouteCtx): void {
  const { pool, requireAuth, requireOrg, requirePermission } = ctx;

  // ── Client-pool patch (counter: replace transaction_customers) ──────────
  router.patch(
    "/:id/client-pool",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const { client_ids, reason } = req.body ?? {};
      if (!Array.isArray(client_ids) || client_ids.some((c: unknown) => typeof c !== "number" || !Number.isFinite(c) || c <= 0)) {
        res.status(400).json({ error: "client_ids must be an array of positive integers" });
        return;
      }
      if (!reason || !String(reason).trim()) {
        res.status(400).json({ error: "reason is required" });
        return;
      }
      let dbClient: import("pg").PoolClient | null = null;
      try {
        const exists = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND organization_id = $2`,
          [id, req.organizationId],
        );
        if (exists.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        await dbClient.query(
          `DELETE FROM accounts.transaction_customers WHERE transaction_id = $1 AND organization_id = $2`,
          [id, req.organizationId],
        );
        if (client_ids.length > 0) {
          const values: string[] = [];
          const params: unknown[] = [];
          let idx = 1;
          for (let i = 0; i < client_ids.length; i++) {
            values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
            params.push(id, client_ids[i], req.organizationId, i);
          }
          await dbClient.query(
            `INSERT INTO accounts.transaction_customers (transaction_id, client_id, organization_id, position)
             VALUES ${values.join(", ")}
             ON CONFLICT (transaction_id, client_id) DO UPDATE SET position = EXCLUDED.position`,
            params,
          );
        }
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, organization_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'counter_edit')`,
          [id, req.organizationId, req.user?.id ?? "", String(reason).trim()],
        );
        await dbClient.query("COMMIT");
        res.json({ ok: true });
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] client-pool patch error:", err);
        res.status(500).json({ error: "Internal server error" });
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  // ── Customer-group started-at patch (counter: update line item times) ──
  router.patch(
    "/:id/customer-group-started-at",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const { updates, reason } = req.body ?? {};
      if (!Array.isArray(updates) || updates.length === 0) {
        res.status(400).json({ error: "updates must be a non-empty array" });
        return;
      }
      for (const u of updates) {
        if (typeof u.customer_group_id !== "number" || !Number.isFinite(u.customer_group_id) || u.customer_group_id <= 0) {
          res.status(400).json({ error: "each update must have a valid customer_group_id" });
          return;
        }
        if (typeof u.started_at !== "string" || Number.isNaN(Date.parse(u.started_at))) {
          res.status(400).json({ error: "each update must have a valid ISO started_at" });
          return;
        }
      }
      if (!reason || !String(reason).trim()) {
        res.status(400).json({ error: "reason is required" });
        return;
      }
      let dbClient: import("pg").PoolClient | null = null;
      try {
        const exists = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND organization_id = $2`,
          [id, req.organizationId],
        );
        if (exists.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        for (const u of updates) {
          // Moving started_at must drag ends_at with it for time-bound lines.
          // ends_at = started_at + (duration_value * quantity) of the line's unit,
          // mirroring the insert in helpers-charge.ts (and the availment_groups
          // combined-end idiom in routes-line-items.ts). Leaving ends_at stale on
          // a start-time edit inverts the window (ends_at < started_at), and the
          // natural-day CASE then buckets the already-"ended" line by its old
          // ends_at date — dropping a today session onto the wrong day board.
          // Non-duration lines (ends_at NULL) are left untouched.
          await dbClient.query(
            `UPDATE accounts.transaction_line_items
                SET started_at = $1::timestamptz,
                    ends_at = CASE
                      WHEN duration_value IS NOT NULL AND duration_unit = 'hour'
                        THEN $1::timestamptz + (duration_value * COALESCE(quantity, 1)) * INTERVAL '1 hour'
                      WHEN duration_value IS NOT NULL AND duration_unit = 'day'
                        THEN $1::timestamptz + (duration_value * COALESCE(quantity, 1)) * INTERVAL '1 day'
                      WHEN duration_value IS NOT NULL AND duration_unit = 'month'
                        THEN $1::timestamptz + (duration_value * COALESCE(quantity, 1)) * INTERVAL '1 month'
                      ELSE ends_at
                    END,
                    updated_at = NOW()
              WHERE customer_group_id = $2 AND transaction_id = $3 AND organization_id = $4`,
            [u.started_at, u.customer_group_id, id, req.organizationId],
          );
        }
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, organization_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'counter_edit')`,
          [id, req.organizationId, req.user?.id ?? "", String(reason).trim()],
        );
        await dbClient.query("COMMIT");
        res.json({ ok: true });
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] customer-group-started-at patch error:", err);
        res.status(500).json({ error: "Internal server error" });
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  // ── Customer-group client patch (counter: replace primary client) ──────
  router.patch(
    "/:id/customer-group-client",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const { customer_group_id, client_id, display_name, reason } = req.body ?? {};
      if (typeof customer_group_id !== "number" || !Number.isFinite(customer_group_id) || customer_group_id <= 0) {
        res.status(400).json({ error: "customer_group_id must be a positive integer" });
        return;
      }
      if (client_id != null && (typeof client_id !== "number" || !Number.isFinite(client_id) || client_id <= 0)) {
        res.status(400).json({ error: "client_id must be a positive integer or null" });
        return;
      }
      if (display_name != null && typeof display_name !== "string") {
        res.status(400).json({ error: "display_name must be a string or null" });
        return;
      }
      if (!reason || !String(reason).trim()) {
        res.status(400).json({ error: "reason is required" });
        return;
      }
      let dbClient: import("pg").PoolClient | null = null;
      try {
        const exists = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND organization_id = $2`,
          [id, req.organizationId],
        );
        if (exists.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        const cgExists = await pool.query(
          `SELECT id FROM accounts.transaction_customer_groups WHERE id = $1 AND transaction_id = $2 AND organization_id = $3`,
          [customer_group_id, id, req.organizationId],
        );
        if (cgExists.rows.length === 0) {
          res.status(404).json({ error: "Customer group not found" });
          return;
        }
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        // Update the customer group's own client_id. display_name is
        // accepted as an optional best-effort update from the frontend
        // (it sends the new client's name_raw), but the column is
        // only the display source for walk-ins — client-linked groups
        // resolve their name dynamically from the clients table at read
        // time, so omitting display_name here is harmless for them.
        const newDisplayName = display_name !== undefined && display_name !== null ? String(display_name) : undefined;
        await dbClient.query(
          `UPDATE accounts.transaction_customer_groups
              SET client_id = $1${newDisplayName !== undefined ? ", display_name = $5" : ""}
            WHERE id = $2 AND transaction_id = $3 AND organization_id = $4`,
          newDisplayName !== undefined
            ? [client_id ?? null, customer_group_id, id, req.organizationId, newDisplayName]
            : [client_id ?? null, customer_group_id, id, req.organizationId],
        );
        await dbClient.query(
          `UPDATE accounts.transaction_line_items SET client_id = $1 WHERE customer_group_id = $2 AND transaction_id = $3 AND organization_id = $4`,
          [client_id ?? null, customer_group_id, id, req.organizationId],
        );
        // When the payer's customer group changes clients, sync the
        // top-level transaction.client_id so the counter listing card
        // header (which reads t.client_id, not cg.client_id) reflects
        // the new billed-to name without a page refresh. The EXISTS
        // guard means only payer-group changes trigger this.
        await dbClient.query(
          `UPDATE accounts.transactions
              SET client_id = $1
            WHERE id = $2 AND organization_id = $3
              AND EXISTS (SELECT 1 FROM accounts.transaction_customer_groups
                           WHERE id = $4 AND is_payer = TRUE)`,
          [client_id ?? null, id, req.organizationId, customer_group_id],
        );
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, organization_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'counter_edit')`,
          [id, req.organizationId, req.user?.id ?? "", String(reason).trim()],
        );
        await dbClient.query("COMMIT");
        res.json({ ok: true });
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] customer-group-client patch error:", err);
        res.status(500).json({ error: "Internal server error" });
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );
}
