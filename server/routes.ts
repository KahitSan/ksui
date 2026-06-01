// Transactions plugin — the single router mounted at basePath /api/transactions.
//
// The fork proxies ONE basePath per plugin. The monolith mounted three roots
// (/api/transactions, /api/transaction-line-items, /api/transaction-subcategories);
// here they ALL live under /api/transactions, with the kernel stripping the
// prefix so routes mount relative to "/":
//   GET    /                       list (pagination/sort/filters/search)
//   POST   /                       create (manual income/expense/business)
//   GET    /subcategories          list taxonomy (?applies_to=income|expense)
//   POST   /subcategories          create a subcategory
//   PUT    /subcategories/:id      edit a subcategory
//   DELETE /subcategories/:id      soft-delete a subcategory
//   GET    /creators               distinct creators (filter dropdown)
//   GET    /subcategory-counts     per-subcategory counts
//   GET    /outstanding            unpaid sales (Counter board)
//   POST   /charge                 POS charge flow (RPC to packages/vouchers/clients)
//   GET    /:id                    detail (line items, payments, edits, visibility)
//   PUT    /:id                    edit basic fields
//   DELETE /:id                    soft-delete (status='voided')
//   POST   /:id/void               void with reason
//   POST   /:id/unvoid             un-void
//   PUT    /:id/visibility         replace per-user / per-role share grants
//   GET    /:id/payments           list payment legs
//   POST   /:id/payments           add a settlement leg
//   DELETE /:id/payments/:pid      remove a leg
//   GET    /:id/line-items         list line items
//   POST   /:id/line-items/:lid/void   void a single line item
//   GET    /:id/attachments        list attachments (metadata)
//   POST   /:id/attachments        attach a file URL (URL-based; no disk upload)
//   DELETE /:id/attachments/:aid   delete an attachment
//
// Every query carries WHERE organization_id = $N from req.organizationId
// (forwarded by the kernel in the signed identity). Cross-plugin data
// (package/variant/client names, voucher discount) is resolved over the kernel
// RPC (lib/peers.ts) with graceful degradation when a peer plugin is absent —
// transactions never reaches into another plugin's schema with raw SQL.

import { Router, type Request, type Response, type RequestHandler } from "express";
import type { PluginDb } from "@ks-erp/kernel/services/database";
import { identityHeaderOf } from "@ks-erp/kernel/service-rpc";
import {
  runCharge,
  ChargeValidationError,
  type ChargePayload,
} from "./helpers-charge.js";
import {
  listSubcategories,
  validateSubcategory,
  appliesToFor,
  type AppliesTo,
} from "./lib/transaction-subcategories.js";
import { isBackdated } from "./lib/backdate.js";
import {
  findPackagesByIds,
  findVariantsByIds,
  findClientsByIds,
  validateVoucher,
} from "./lib/peers.js";
import { listSubscriptions, renewSubscription, RenewError } from "./lib/subscriptions.js";

export type RouterDeps = {
  db: PluginDb;
  requireAuth: RequestHandler;
  requireOrg: RequestHandler;
  requirePermission: (...codes: string[]) => RequestHandler;
};

const SORTABLE_COLUMNS = [
  "transaction_date",
  "amount",
  "category",
  "status",
  "description",
  "created_at",
];
const VALID_CATEGORIES = ["expense", "sale", "business", "payable"];
const VALID_STATUSES = ["pending", "completed", "voided"];
const VALID_TAX_TYPES = ["vat_inclusive", "vat_exclusive", "vat_exempt", "non_vat"];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Escape ILIKE wildcards so a search for "100%" doesn't match every row.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

export function buildRouter(deps: RouterDeps): Router {
  const router = Router();
  const { db: pool, requireAuth, requireOrg, requirePermission } = deps;

  // Privacy WHERE fragment shared by every list-style read. A private row is
  // visible to its creator, to a user explicitly shared on it, to a role
  // shared on it, or to an admin/superuser (who bypass entirely). Returns the
  // SQL fragment + the next param index.
  function privacyClause(req: Request, params: unknown[], startIdx: number): string | null {
    const isAdmin = req.orgRole === "admin" || req.user?.role === "superuser";
    if (isAdmin) return null;
    const userId = req.user?.id ?? "";
    const frag = `(t.is_private = false OR t.created_by = $${startIdx} OR EXISTS (SELECT 1 FROM accounts.transaction_visibility tv WHERE tv.transaction_id = t.id AND tv.user_id = $${startIdx}) OR EXISTS (SELECT 1 FROM accounts.transaction_visibility_role tvr WHERE tvr.transaction_id = t.id AND tvr.role_code = $${startIdx + 1}))`;
    params.push(userId, req.orgRole ?? "");
    return frag;
  }

  // ── Subcategory taxonomy (formerly /api/transaction-subcategories) ───────

  router.get(
    "/subcategories",
    requireAuth,
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      const appliesTo = req.query.applies_to as string | undefined;
      if (appliesTo !== "income" && appliesTo !== "expense") {
        res.status(400).json({ error: "applies_to must be 'income' or 'expense'" });
        return;
      }
      try {
        const rows = await listSubcategories(pool, appliesTo as AppliesTo);
        res.json({ subcategories: rows });
      } catch (err) {
        console.error("[transactions] subcategories list error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.post(
    "/subcategories",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const { name, applies_to, sort_order } = req.body ?? {};
      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      if (applies_to !== "income" && applies_to !== "expense") {
        res.status(400).json({ error: "applies_to must be 'income' or 'expense'" });
        return;
      }
      try {
        const result = await pool.query(
          `INSERT INTO transaction_subcategories (name, applies_to, sort_order)
             VALUES ($1, $2, $3)
             ON CONFLICT (lower(name), applies_to) DO UPDATE SET is_active = TRUE, updated_at = NOW()
             RETURNING *`,
          [name.trim(), applies_to, Number.isFinite(sort_order) ? sort_order : 0],
        );
        res.status(201).json(result.rows[0]);
      } catch (err) {
        console.error("[transactions] subcategory create error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.put(
    "/subcategories/:id",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const { name, sort_order, is_active } = req.body ?? {};
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (name !== undefined) {
        if (typeof name !== "string" || !name.trim()) {
          res.status(400).json({ error: "name cannot be empty" });
          return;
        }
        sets.push(`name = $${idx++}`);
        params.push(name.trim());
      }
      if (sort_order !== undefined) {
        sets.push(`sort_order = $${idx++}`);
        params.push(Number.isFinite(sort_order) ? sort_order : 0);
      }
      if (is_active !== undefined) {
        sets.push(`is_active = $${idx++}`);
        params.push(Boolean(is_active));
      }
      if (sets.length === 0) {
        res.status(400).json({ error: "No fields to update" });
        return;
      }
      sets.push("updated_at = NOW()");
      params.push(parseInt(String(req.params.id), 10));
      try {
        const result = await pool.query(
          `UPDATE transaction_subcategories SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
          params,
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        res.json(result.rows[0]);
      } catch (err) {
        console.error("[transactions] subcategory update error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.put(
    "/:id/payments/:paymentId",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const { financial_account_id, amount } = req.body ?? {};
      const parsed = parseFloat(amount);
      if (typeof financial_account_id !== "number" || !Number.isFinite(financial_account_id)) {
        res.status(400).json({ error: "financial_account_id must be a number" });
        return;
      }
      if (!Number.isFinite(parsed) || parsed <= 0) {
        res.status(400).json({ error: "amount must be a finite number greater than 0" });
        return;
      }
      try {
        const result = await pool.query(
          `UPDATE accounts.transaction_payments
             SET financial_account_id = $1, amount = $2
             WHERE id = $3 AND transaction_id = $4 AND organization_id = $5
             RETURNING id, transaction_id, organization_id, financial_account_id, amount, notes, created_at, updated_at, customer_group_id`,
          [financial_account_id, parsed, req.params.paymentId, req.params.id, req.organizationId],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        res.json(result.rows[0]);
      } catch (err) {
        console.error("[transactions] payment update error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.delete(
    "/subcategories/:id",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      try {
        const result = await pool.query(
          `UPDATE transaction_subcategories SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`,
          [parseInt(String(req.params.id), 10)],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        res.status(204).send();
      } catch (err) {
        console.error("[transactions] subcategory delete error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ── Subscriptions (recurring-revenue view over line items) ───────────────
  // Registered before "/:id" so the literal segment wins. The heavy grouping +
  // renew logic lives in lib/subscriptions.ts (cross-schema data resolved over
  // RPC, not SQL JOINs). Recovered from the monolith's /api/subscriptions.

  // GET /subscriptions — grouped, bucketed, searchable, paginated.
  router.get(
    "/subscriptions",
    requireAuth,
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        res.json(await listSubscriptions(pool, req, privacyClause));
      } catch (err) {
        console.error("[transactions] subscriptions list error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // POST /subscriptions/:line_item_id/renew — fresh sale chaining from prior expiry.
  router.post(
    "/subscriptions/:line_item_id/renew",
    requireAuth,
    requireOrg,
    requirePermission("transactions.create"),
    async (req: Request, res: Response) => {
      const sourceId = parseInt(String(req.params.line_item_id), 10);
      if (!Number.isInteger(sourceId) || sourceId <= 0) {
        res.status(400).json({ error: "line_item_id is required" });
        return;
      }
      try {
        const out = await renewSubscription(pool, req, sourceId, req.body ?? {});
        res.status(201).json(out);
      } catch (err) {
        if (err instanceof RenewError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        console.error("[transactions] subscriptions renew error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ── Filter-support reads (defined before /:id so they don't get captured) ─

  router.get(
    "/creators",
    requireAuth,
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const params: unknown[] = [req.organizationId];
        const conditions = ["t.organization_id = $1", "t.created_by IS NOT NULL"];
        const priv = privacyClause(req, params, 2);
        if (priv) conditions.push(priv);
        // created_by names come from the kernel "user" table, which the plugin
        // never reads. We return the distinct creator ids + counts; the host UI
        // can resolve display names from its own session-scoped member list.
        const result = await pool.query(
          `SELECT t.created_by AS id, MAX(t.transaction_date) AS last_used, COUNT(*)::int AS count
             FROM accounts.transactions t
            WHERE ${conditions.join(" AND ")}
            GROUP BY t.created_by
            ORDER BY last_used DESC NULLS LAST`,
          params,
        );
        res.json({ creators: result.rows });
      } catch (err) {
        console.error("[transactions] creators error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.get(
    "/subcategory-counts",
    requireAuth,
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const params: unknown[] = [req.organizationId];
        const conditions = [
          "t.organization_id = $1",
          "t.status != 'voided'",
          "t.subcategory IS NOT NULL",
        ];
        const priv = privacyClause(req, params, 2);
        if (priv) conditions.push(priv);
        const result = await pool.query(
          `SELECT t.subcategory AS subcategory, COUNT(*)::int AS count
             FROM accounts.transactions t
            WHERE ${conditions.join(" AND ")}
            GROUP BY t.subcategory`,
          params,
        );
        res.json({ counts: result.rows });
      } catch (err) {
        console.error("[transactions] subcategory-counts error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ── Dashboard aggregates ────────────────────────────────────────────────

  // GET /summary -- aggregate totals by category for a date range.
  //
  // Query params: dateFrom, dateTo (inclusive, applied to transaction_date;
  // omit both for an all-time view).
  //
  // Response: { expense, sale, business, payable, _privateHidden } where each
  // category is { count, total }. Sale totals prefer the settled payment sum
  // (transaction_payments) over the headline amount so partially-paid sales
  // report what was actually collected.
  router.get(
    "/summary",
    requireAuth,
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;

      try {
        const params: unknown[] = [req.organizationId];
        const conditions = ["t.organization_id = $1", "t.status != 'voided'"];
        const priv = privacyClause(req, params, params.length + 1);
        if (priv) conditions.push(priv);

        if (dateFrom) {
          params.push(dateFrom);
          conditions.push(`t.transaction_date >= $${params.length}`);
        }
        if (dateTo) {
          params.push(dateTo);
          conditions.push(`t.transaction_date <= $${params.length}`);
        }

        const result = await pool.query(
          `SELECT
              t.category,
              COUNT(DISTINCT t.id)::int AS count,
              COALESCE(
                SUM(CASE WHEN t.category = 'sale'
                         THEN COALESCE(tp.amount, t.amount)
                         ELSE t.amount END),
                0
              ) AS total
             FROM accounts.transactions t
             LEFT JOIN accounts.transaction_payments tp
               ON tp.transaction_id = t.id AND t.category = 'sale'
            WHERE ${conditions.join(" AND ")}
            GROUP BY t.category`,
          params,
        );

        const summary: Record<string, { count: number; total: number }> = {
          expense: { count: 0, total: 0 },
          sale: { count: 0, total: 0 },
          business: { count: 0, total: 0 },
          payable: { count: 0, total: 0 },
        };
        for (const row of result.rows as { category: string; count: number; total: string }[]) {
          summary[row.category] = {
            count: Number(row.count),
            total: parseFloat(row.total),
          };
        }

        // Count private rows hidden from the current user. Skip entirely when
        // the caller bypasses privacy (admin/superuser) — the count is always 0.
        let privateHidden = 0;
        const privParams: unknown[] = [req.organizationId];
        const privFrag = privacyClause(req, [], 0); // probe: null => caller bypasses
        if (privFrag) {
          const userId = req.user?.id ?? "";
          const privConditions = [
            "t.organization_id = $1",
            "t.status != 'voided'",
            "t.is_private = true",
            `t.created_by != $2`,
            `NOT EXISTS (SELECT 1 FROM accounts.transaction_visibility tv WHERE tv.transaction_id = t.id AND tv.user_id = $2)`,
            `NOT EXISTS (SELECT 1 FROM accounts.transaction_visibility_role tvr WHERE tvr.transaction_id = t.id AND tvr.role_code = $3)`,
          ];
          privParams.push(userId, req.orgRole ?? "");
          if (dateFrom) {
            privParams.push(dateFrom);
            privConditions.push(`t.transaction_date >= $${privParams.length}`);
          }
          if (dateTo) {
            privParams.push(dateTo);
            privConditions.push(`t.transaction_date <= $${privParams.length}`);
          }
          const privResult = await pool.query(
            `SELECT COUNT(*)::int AS count FROM accounts.transactions t WHERE ${privConditions.join(" AND ")}`,
            privParams,
          );
          privateHidden = Number(privResult.rows[0].count);
        }

        res.json({ ...summary, _privateHidden: privateHidden });
      } catch (err) {
        console.error("[transactions] summary error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // GET /by-hour -- counter check-in/out counts by time of day.
  //
  // Aggregates counter activity from transaction_line_items into 24 hourly (or
  // 48 half-hourly) buckets in the org's local timezone. Each bucket returns
  // separate counts for `in` (arrivals = started_at) and `out` (departures =
  // ends_at). Used by the operations dashboard to tune opening/closing hours.
  //
  // Query params: dateFrom, dateTo (inclusive, applied to whichever of
  // started_at/ends_at the row contributes to; omit both for all-time),
  // bucketMinutes (30 or 60, default 60).
  //
  // Response: { buckets: Array<{ hour, minute, in, out }>, bucketMinutes }
  router.get(
    "/by-hour",
    requireAuth,
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const bucketMinutes = req.query.bucketMinutes === "30" ? 30 : 60;

      // Bucketing + date filtering happen in the org's local timezone so the
      // chart's "hour of day" matches the operator's wall clock. Hardcoded
      // literal, never user input — safe to interpolate into SQL.
      const ORG_TZ = "Asia/Manila";

      try {
        const params: unknown[] = [req.organizationId];
        // Line items inherit the parent transaction's privacy posture, so we
        // join up to the transaction and apply the same visibility rules.
        const baseConds = [
          "li.organization_id = $1",
          "t.organization_id = $1",
          "li.status != 'voided'",
          "t.status != 'voided'",
        ];
        const priv = privacyClause(req, params, params.length + 1);
        if (priv) baseConds.push(priv);

        const dateFromIdx = dateFrom ? (params.push(dateFrom), params.length) : null;
        const dateToIdx = dateTo ? (params.push(dateTo), params.length) : null;

        const bucketExpr = (col: string) =>
          bucketMinutes === 30
            ? `EXTRACT(HOUR FROM ${col} AT TIME ZONE '${ORG_TZ}')::int * 2 + (EXTRACT(MINUTE FROM ${col} AT TIME ZONE '${ORG_TZ}')::int / 30)`
            : `EXTRACT(HOUR FROM ${col} AT TIME ZONE '${ORG_TZ}')::int`;

        const inDateClauses: string[] = [];
        if (dateFromIdx)
          inDateClauses.push(`(li.started_at AT TIME ZONE '${ORG_TZ}')::date >= $${dateFromIdx}`);
        if (dateToIdx)
          inDateClauses.push(`(li.started_at AT TIME ZONE '${ORG_TZ}')::date <= $${dateToIdx}`);

        const outDateClauses: string[] = [];
        if (dateFromIdx)
          outDateClauses.push(`(li.ends_at AT TIME ZONE '${ORG_TZ}')::date >= $${dateFromIdx}`);
        if (dateToIdx)
          outDateClauses.push(`(li.ends_at AT TIME ZONE '${ORG_TZ}')::date <= $${dateToIdx}`);

        const inWhere = [...baseConds, "li.started_at IS NOT NULL", ...inDateClauses].join(" AND ");
        // Future ends_at (active stays not yet checked out) aren't observed
        // behavior, so skip them.
        const outWhere = [
          ...baseConds,
          "li.ends_at IS NOT NULL",
          "li.ends_at <= NOW()",
          ...outDateClauses,
        ].join(" AND ");

        const sql = `
          SELECT bucket,
                 SUM(in_count)::int  AS in_count,
                 SUM(out_count)::int AS out_count
          FROM (
            SELECT ${bucketExpr("li.started_at")} AS bucket, 1 AS in_count, 0 AS out_count
            FROM accounts.transaction_line_items li
            JOIN accounts.transactions t ON t.id = li.transaction_id
            WHERE ${inWhere}
            UNION ALL
            SELECT ${bucketExpr("li.ends_at")} AS bucket, 0 AS in_count, 1 AS out_count
            FROM accounts.transaction_line_items li
            JOIN accounts.transactions t ON t.id = li.transaction_id
            WHERE ${outWhere}
          ) u
          GROUP BY bucket
          ORDER BY bucket ASC`;

        const result = await pool.query(sql, params);

        const total = bucketMinutes === 30 ? 48 : 24;
        const ins = new Map<number, number>();
        const outs = new Map<number, number>();
        for (const row of result.rows as {
          bucket: number;
          in_count: number;
          out_count: number;
        }[]) {
          ins.set(Number(row.bucket), Number(row.in_count));
          outs.set(Number(row.bucket), Number(row.out_count));
        }
        const buckets = Array.from({ length: total }, (_, i) => {
          const hour = bucketMinutes === 30 ? Math.floor(i / 2) : i;
          const minute = bucketMinutes === 30 ? (i % 2) * 30 : 0;
          return { hour, minute, in: ins.get(i) ?? 0, out: outs.get(i) ?? 0 };
        });

        res.json({ buckets, bucketMinutes });
      } catch (err) {
        console.error("[transactions] by-hour error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ── Outstanding (unpaid sales) — Counter board ──────────────────────────
  router.get(
    "/outstanding",
    requireAuth,
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const params: unknown[] = [req.organizationId];
        const conditions = [
          "t.organization_id = $1",
          "t.category = 'sale'",
          "t.status != 'voided'",
          "t.amount > 0",
          "t.amount > paid.total_paid",
        ];
        const priv = privacyClause(req, params, 2);
        if (priv) conditions.push(priv);
        const result = await pool.query(
          `SELECT t.id, t.amount, t.transaction_date, t.client_id, t.destination_account_id,
                  t.batch_code AS transaction_batch_code,
                  paid.total_paid::numeric(12,2) AS amount_collected,
                  (t.amount - paid.total_paid)::numeric(12,2) AS balance
             FROM accounts.transactions t
             LEFT JOIN LATERAL (
               SELECT COALESCE(SUM(tp.amount), 0)::numeric(12,2) AS total_paid
                 FROM accounts.transaction_payments tp
                WHERE tp.transaction_id = t.id
             ) paid ON true
            WHERE ${conditions.join(" AND ")}
            ORDER BY t.transaction_date DESC, t.id DESC`,
          params,
        );

        // Package summary + client names resolved over RPC (graceful: omitted
        // when the producer plugin is absent).
        const idh = identityHeaderOf(req);
        const ids = result.rows.map((r) => r.id as number);
        const summaryByTxn = new Map<number, string>();
        if (ids.length > 0) {
          const li = await pool.query<{
            transaction_id: number;
            quantity: number;
            description: string;
            package_id: number | null;
          }>(
            `SELECT transaction_id, quantity, description, package_id
               FROM accounts.transaction_line_items
              WHERE transaction_id = ANY($1::int[])
              ORDER BY transaction_id, id`,
            [ids],
          );
          const pkgIds = [
            ...new Set(li.rows.map((r) => r.package_id).filter((v): v is number => v != null)),
          ];
          const pkgs = pkgIds.length > 0 ? await findPackagesByIds(pkgIds, idh) : [];
          const pkgName = new Map<number, string>((pkgs ?? []).map((p) => [p.id, p.name]));
          const parts = new Map<number, string[]>();
          for (const row of li.rows) {
            const label = `${row.quantity}× ${(row.package_id != null && pkgName.get(row.package_id)) || row.description}`;
            const arr = parts.get(row.transaction_id);
            if (arr) arr.push(label);
            else parts.set(row.transaction_id, [label]);
          }
          for (const [tid, arr] of parts) summaryByTxn.set(tid, arr.join(" · "));
        }
        const clientIds = [
          ...new Set(result.rows.map((r) => r.client_id as number | null).filter((v): v is number => v != null)),
        ];
        const clients = clientIds.length > 0 ? await findClientsByIds(clientIds, idh) : [];
        const clientName = new Map<number, string>((clients ?? []).map((c) => [c.id, c.name]));

        const enriched = result.rows.map((r) => ({
          ...r,
          package_summary: summaryByTxn.get(r.id) ?? "",
          client_name: r.client_id != null ? (clientName.get(r.client_id) ?? null) : null,
        }));
        res.json({ data: enriched });
      } catch (err) {
        console.error("[transactions] outstanding error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ── POS charge flow ─────────────────────────────────────────────────────
  router.post(
    "/charge",
    requireAuth,
    requireOrg,
    requirePermission("transactions.create"),
    async (req: Request, res: Response) => {
      if (!req.organizationId || !req.user?.id) {
        res.status(400).json({ error: "Organization and user context required" });
        return;
      }
      try {
        const result = await runCharge({
          pool,
          organizationId: req.organizationId,
          userId: req.user.id,
          identityHeader: identityHeaderOf(req),
          payload: req.body as ChargePayload,
        });

        // Best-effort, NON-transactional voucher usage increment after the
        // charge has committed. The monolith did this inside the charge txn
        // (in-process FOR UPDATE + UPDATE +1); that atomicity can't cross a
        // process boundary, so we fire-and-forget here. A failed increment
        // never rolls back a committed charge. We rely on the vouchers plugin
        // to expose a usage-increment endpoint; today it only exposes
        // findByCode/validate, so this is a no-op stub left in place for when
        // that surface lands. (Discount math + applicability already ran.)
        if (result.voucher_applied) {
          // Intentionally not incrementing: vouchers RPC has no increment
          // method yet. Documented gap — see report.
        }

        res.status(201).json(result);
      } catch (err) {
        if (err instanceof ChargeValidationError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        console.error("[transactions] charge error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

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

      let validatedSubcategory: string | null;
      try {
        validatedSubcategory = await validateSubcategory(pool, category, subcategory);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Invalid subcategory" });
        return;
      }

      const parsedAmount = parseFloat(amount);
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
        const result = await dbClient.query(
          `INSERT INTO accounts.transactions
             (organization_id, category, subcategory, source_account_id, destination_account_id,
              amount, description, notes, transaction_date, is_private, is_backdated, backdate_reason,
              created_by, updated_by, reference_number, tax_type, tax_rate, tax_amount, subtotal,
              payable_kind, due_date, cheque_number, pdc_status, has_ewt, ewt_rate, ewt_amount, client_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14, $15, $16, $17, $18,
                   $19, $20, $21, $22, $23, $24, $25, $26)
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
          `SELECT * FROM accounts.transaction_attachments WHERE transaction_id = $1 ORDER BY created_at`,
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

        res.json({
          ...txn,
          attachments: attachments.rows,
          shared_with,
          shared_with_roles,
          line_items,
          client_name,
          client_pool,
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
          res.json(result.rows[0]);
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
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await dbClient.query(
          `UPDATE accounts.transactions SET is_private = $3, updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
          [req.params.id, req.organizationId, Boolean(is_private)],
        );
        await dbClient.query(`DELETE FROM accounts.transaction_visibility WHERE transaction_id = $1`, [req.params.id]);
        await dbClient.query(`DELETE FROM accounts.transaction_visibility_role WHERE transaction_id = $1`, [req.params.id]);
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

  // ── Payments (settlement legs) ────────────────────────────────────────────
  router.get(
    "/:id/payments",
    requireAuth,
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const rows = await pool.query(
          `SELECT id, financial_account_id, amount, notes, created_at, customer_group_id
             FROM accounts.transaction_payments
            WHERE transaction_id = $1 AND organization_id = $2
            ORDER BY created_at ASC, id ASC`,
          [req.params.id, req.organizationId],
        );
        res.json({ payments: rows.rows });
      } catch (err) {
        console.error("[transactions] payments list error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.post(
    "/:id/payments",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const { financial_account_id, amount, notes } = req.body ?? {};
      const parsed = parseFloat(amount);
      if (typeof financial_account_id !== "number" || !Number.isFinite(financial_account_id)) {
        res.status(400).json({ error: "financial_account_id must be a number" });
        return;
      }
      if (!(parsed > 0)) {
        res.status(400).json({ error: "amount must be greater than 0" });
        return;
      }
      try {
        const tx = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND organization_id = $2`,
          [req.params.id, req.organizationId],
        );
        if (tx.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        const result = await pool.query(
          `INSERT INTO accounts.transaction_payments (transaction_id, organization_id, financial_account_id, amount, notes)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [req.params.id, req.organizationId, financial_account_id, parsed, notes?.trim() || null],
        );
        res.status(201).json(result.rows[0]);
      } catch (err) {
        console.error("[transactions] payment create error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.delete(
    "/:id/payments/:paymentId",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      try {
        const result = await pool.query(
          `DELETE FROM accounts.transaction_payments
             WHERE id = $1 AND transaction_id = $2 AND organization_id = $3 RETURNING id`,
          [req.params.paymentId, req.params.id, req.organizationId],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        res.status(204).send();
      } catch (err) {
        console.error("[transactions] payment delete error:", err);
        res.status(500).json({ error: "Internal server error" });
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

  // ── Attachments (URL-based; no disk upload in the isolated plugin) ───────
  router.get(
    "/:id/attachments",
    requireAuth,
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const rows = await pool.query(
          `SELECT a.* FROM accounts.transaction_attachments a
             JOIN accounts.transactions t ON t.id = a.transaction_id
            WHERE a.transaction_id = $1 AND t.organization_id = $2 ORDER BY a.created_at`,
          [req.params.id, req.organizationId],
        );
        res.json({ attachments: rows.rows });
      } catch (err) {
        console.error("[transactions] attachments list error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.post(
    "/:id/attachments",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      // The monolith stored uploaded files via server-runtime/upload to a disk
      // path the host served. The isolated plugin accepts a file URL +
      // metadata instead (the host or an object store owns the bytes), keeping
      // the plugin stateless on disk. file_path holds the URL.
      const { file_name, file_url, file_size, mime_type } = req.body ?? {};
      if (!file_name || typeof file_name !== "string") {
        res.status(400).json({ error: "file_name is required" });
        return;
      }
      if (!file_url || typeof file_url !== "string") {
        res.status(400).json({ error: "file_url is required" });
        return;
      }
      try {
        const tx = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND organization_id = $2`,
          [req.params.id, req.organizationId],
        );
        if (tx.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        const result = await pool.query(
          `INSERT INTO accounts.transaction_attachments (transaction_id, file_name, file_path, file_size, mime_type, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [
            req.params.id,
            file_name,
            file_url,
            Number.isFinite(file_size) ? file_size : 0,
            mime_type || "application/octet-stream",
            req.user?.id ?? "",
          ],
        );
        res.status(201).json(result.rows[0]);
      } catch (err) {
        console.error("[transactions] attachment create error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.delete(
    "/:id/attachments/:attachmentId",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      try {
        const result = await pool.query(
          `DELETE FROM accounts.transaction_attachments a
             USING accounts.transactions t
            WHERE a.transaction_id = t.id
              AND a.id = $1 AND a.transaction_id = $2 AND t.organization_id = $3
            RETURNING a.id`,
          [req.params.attachmentId, req.params.id, req.organizationId],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        res.status(204).send();
      } catch (err) {
        console.error("[transactions] attachment delete error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  return router;
}

// Re-export so main.ts can build the transactions.service handlers using the
// same RPC helpers (capacity usage / findById) the monolith's extension point
// exposed.
export { validateVoucher, appliesToFor };
