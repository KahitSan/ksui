// Analytics + filter-support reads for the transactions router.
//
// The literal-segment GET reads that power the filter dropdowns and the
// dashboard charts: /subscriptions (+ renew), /creators, /subcategory-counts,
// /summary, /cashflow, /by-hour. Extracted verbatim from routes.ts so the
// per-resource route modules can share one source of truth. registerAnalyticsRoutes
// mounts them onto the passed router under the same paths and middleware chain;
// the call site in buildRouter registers them in the same position as before —
// ahead of "/:id" so the literal segments win.
//
// Timezone discipline preserved exactly: /by-hour buckets + date-filters in
// Asia/Manila (AT TIME ZONE casts), /cashflow uses to_char on the stored
// transaction_date `date` with NO timezone cast (deliberate). privacyClause
// calls are unchanged.

import { type Hono, type Context as HonoContext, type MiddlewareHandler } from "hono";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { listSubscriptions, renewSubscription, RenewError } from "../lib/subscriptions.js";
import { privacyClause } from "./shared.js";

export type AnalyticsRouteCtx = {
  pool: PluginDb;
  requireAuth: MiddlewareHandler;
  requireWorkspace: MiddlewareHandler;
  requirePermission: (...codes: string[]) => MiddlewareHandler;
};

export function registerAnalyticsRoutes(app: Hono, ctx: AnalyticsRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  // ── Subscriptions (recurring-revenue view over line items) ───────────────
  // Registered before "/:id" so the literal segment wins. The heavy grouping +
  // renew logic lives in lib/subscriptions.ts (cross-schema data resolved over
  // RPC, not SQL JOINs). Recovered from the monolith's /api/subscriptions.

  // GET /subscriptions — grouped, bucketed, searchable, paginated.
  app.get(
    "/subscriptions",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c: HonoContext) => {
      try {
        return c.json(await listSubscriptions(pool, c, privacyClause));
      } catch (err) {
        console.error("[transactions] subscriptions list error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  // POST /subscriptions/:line_item_id/renew — fresh sale chaining from prior expiry.
  app.post(
    "/subscriptions/:line_item_id/renew",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.create"),
    async (c: HonoContext) => {
      const sourceId = parseInt(String(c.req.param("line_item_id")), 10);
      if (!Number.isInteger(sourceId) || sourceId <= 0) {
        return c.json({ error: "line_item_id is required" }, 400);
        return;
      }
      try {
        const out = await renewSubscription(pool, c, sourceId, await c.req.json() ?? {});
        return c.json(out, 201);
      } catch (err) {
        if (err instanceof RenewError) {
          return c.json({ error: err.message }, err.status);
          return;
        }
        console.error("[transactions] subscriptions renew error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  // ── Filter-support reads (defined before /:id so they don't get captured) ─

  app.get(
    "/creators",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c: HonoContext) => {
      try {
        const params: unknown[] = [c.get("workspaceId")];
        const conditions = ["t.workspace_id = $1", "t.created_by IS NOT NULL"];
        const priv = privacyClause(c, params, 2);
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
        return c.json({ creators: result.rows });
      } catch (err) {
        console.error("[transactions] creators error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  app.get(
    "/subcategory-counts",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c: HonoContext) => {
      try {
        const params: unknown[] = [c.get("workspaceId")];
        const conditions = [
          "t.workspace_id = $1",
          "t.status != 'voided'",
          "t.subcategory IS NOT NULL",
        ];
        const priv = privacyClause(c, params, 2);
        if (priv) conditions.push(priv);
        const result = await pool.query(
          `SELECT t.subcategory AS subcategory, COUNT(*)::int AS count
             FROM accounts.transactions t
            WHERE ${conditions.join(" AND ")}
            GROUP BY t.subcategory`,
          params,
        );
        return c.json({ counts: result.rows });
      } catch (err) {
        console.error("[transactions] subcategory-counts error:", err);
        return c.json({ error: "Internal server error" }, 500);
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
  app.get(
    "/summary",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c: HonoContext) => {
      const dateFrom = c.req.query("dateFrom");
      const dateTo = c.req.query("dateTo");

      try {
        const params: unknown[] = [c.get("workspaceId")];
        const conditions = ["t.workspace_id = $1", "t.status != 'voided'"];
        const priv = privacyClause(c, params, params.length + 1);
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
        const privParams: unknown[] = [c.get("workspaceId")];
        const privFrag = privacyClause(c, [], 0); // probe: null => caller bypasses
        if (privFrag) {
          const userId = c.get("user")?.id ?? "";
          const privConditions = [
            "t.workspace_id = $1",
            "t.status != 'voided'",
            "t.is_private = true",
            `t.created_by != $2`,
            `NOT EXISTS (SELECT 1 FROM accounts.transaction_visibility tv WHERE tv.transaction_id = t.id AND tv.user_id = $2)`,
            `NOT EXISTS (SELECT 1 FROM accounts.transaction_visibility_role tvr WHERE tvr.transaction_id = t.id AND tvr.role_code = $3)`,
          ];
          privParams.push(userId, c.get("wsRole") ?? "");
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

        return c.json({ ...summary, _privateHidden: privateHidden });
      } catch (err) {
        console.error("[transactions] summary error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  // GET /cashflow -- per-day inflow/outflow buckets for the analytics chart.
  //
  // One row per day that had activity (the bucket array is sparse) with:
  //   in       sales -- prefers the settled payment sum over the headline amount
  //   out      expenses + payables
  //   transfer business moves
  // all in pesos. transaction_date is a stored `date`, so to_char gives the
  // natural Manila day with no timezone cast (see the timezone discipline rule).
  //
  // Query params: dateFrom, dateTo (inclusive, applied to transaction_date;
  // omit both for all-time). Privacy-gated identically to /summary.
  //
  // Response: { buckets: Array<{ date, in, out, transfer }> }
  app.get(
    "/cashflow",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c: HonoContext) => {
      const dateFrom = c.req.query("dateFrom");
      const dateTo = c.req.query("dateTo");

      try {
        const params: unknown[] = [c.get("workspaceId")];
        const conditions = ["t.workspace_id = $1", "t.status != 'voided'"];
        const priv = privacyClause(c, params, params.length + 1);
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
              to_char(t.transaction_date, 'YYYY-MM-DD') AS date,
              COALESCE(SUM(CASE WHEN t.category = 'sale'
                                THEN COALESCE(tp.amount, t.amount) ELSE 0 END), 0) AS in_amt,
              COALESCE(SUM(CASE WHEN t.category IN ('expense', 'payable')
                                THEN t.amount ELSE 0 END), 0) AS out_amt,
              COALESCE(SUM(CASE WHEN t.category = 'business'
                                THEN t.amount ELSE 0 END), 0) AS transfer_amt
             FROM accounts.transactions t
             LEFT JOIN accounts.transaction_payments tp
               ON tp.transaction_id = t.id AND t.category = 'sale'
            WHERE ${conditions.join(" AND ")}
            GROUP BY t.transaction_date
            ORDER BY t.transaction_date ASC`,
          params,
        );

        return c.json({
          buckets: (
            result.rows as { date: string; in_amt: string; out_amt: string; transfer_amt: string }[]
          ).map((r) => ({
            date: r.date,
            in: parseFloat(r.in_amt),
            out: parseFloat(r.out_amt),
            transfer: parseFloat(r.transfer_amt),
          })),
        });
      } catch (err) {
        console.error("[transactions] cashflow error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  // GET /by-hour -- counter check-in/out counts by time of day.
  //
  // Aggregates counter activity from transaction_line_items into 24 hourly (or
  // 48 half-hourly) buckets in the workspace's local timezone. Each bucket returns
  // separate counts for `in` (arrivals = started_at) and `out` (departures =
  // ends_at). Used by the operations dashboard to tune opening/closing hours.
  //
  // Query params: dateFrom, dateTo (inclusive, applied to whichever of
  // started_at/ends_at the row contributes to; omit both for all-time),
  // bucketMinutes (30 or 60, default 60).
  //
  // Response: { buckets: Array<{ hour, minute, in, out }>, bucketMinutes }
  app.get(
    "/by-hour",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c: HonoContext) => {
      const dateFrom = c.req.query("dateFrom");
      const dateTo = c.req.query("dateTo");
      const bucketMinutes = c.req.query("bucketMinutes") === "30" ? 30 : 60;

      // Bucketing + date filtering happen in the workspace's local timezone so the
      // chart's "hour of day" matches the operator's wall clock. Hardcoded
      // literal, never user input — safe to interpolate into SQL.
      const ORG_TZ = "Asia/Manila";

      try {
        const params: unknown[] = [c.get("workspaceId")];
        // Line items inherit the parent transaction's privacy posture, so we
        // join up to the transaction and apply the same visibility rules.
        const baseConds = [
          "li.workspace_id = $1",
          "t.workspace_id = $1",
          "li.status != 'voided'",
          "t.status != 'voided'",
        ];
        const priv = privacyClause(c, params, params.length + 1);
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

        return c.json({ buckets, bucketMinutes });
      } catch (err) {
        console.error("[transactions] by-hour error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );
}
