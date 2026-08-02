// Transactions plugin — transaction line items router.
//
// The fork proxies ONE primary basePath per plugin, but the manifest also
// declares `additionalBasePaths: ["/api/transaction-line-items"]`. The kernel
// reverse-proxies that sibling prefix to THIS plugin's port WITHOUT stripping
// it (see kserp-fork/server/plugin-proxy.ts), so the plugin receives the full
// `/api/transaction-line-items/...` path. main.ts mounts this router at exactly
// that prefix; the routes below are written relative to it.
//
// This powers the Counter board's active-sessions list plus the settle /
// extend / charge-overage actions. It is a faithful port of the monolith's
// kplugins/transactions/server/routes-line-items.ts, adapted to the
// process-isolation model:
//   - Cross-plugin reads (package/variant/client names, voucher code) go over
//     the kernel RPC (lib/peers.ts) with graceful degradation, never raw
//     cross-schema SQL.
//   - The permission/privacy/backdate gates read the kernel-forwarded
//     ctxGet(c, "permissions") / ctxGet(c, "wsRole") instead of the monolith's async
//     getPermissionsFor / canBypassTransactionPrivacy.
//   - The monolith's `links.create` shadow-write is dropped (no cross-process
//     links runner in the fork; the in-row package_variant_id FK is the source
//     of truth) — same posture helpers-charge.ts already takes.
//   - account names (source/destination) are NOT resolved: accounts.financial_
//     accounts belongs to the financial-accounts plugin and may be absent when
//     transactions runs standalone, so a JOIN would throw. The fields stay in
//     the response shape as null; the counter card treats them as optional.
//   - voucher_code is emitted as null: the vouchers plugin RPC exposes lookup
//     by code, not by id, and transactions stores only voucher_id. Graceful
//     degradation, consistent with the rest of the plugin.

import { Hono } from "hono";
import { identityHeaderOf } from "@kahitsan/plugin-sdk";
import {
  findPackagesByIds,
  findVariantsByIds,
  findClientsByIds,
  findVoucherById,
} from "./lib/peers.js";
import type { RouterDeps } from "./routes.js";
import { ctxGet, isWorkspaceElevated } from "./types.js";
import { LINE_ITEM_COLS } from "./routes/shared.js";
import { bumpBoardVersion } from "./lib/board-events.js";
import { registerLineItemEventsRoute } from "./routes/line-items-events.js";
import { registerLineItemExtendRoutes } from "./routes/line-items-extend.js";

function buildProjectionSql(
  legacySql: string,
  baseConditions: string[],
  projectionDateClauses: string[],
  pageSize: number,
): string {
  const marker = "           ), matched AS (";
  const markerAt = legacySql.indexOf(marker);
  if (markerAt < 0) throw new Error("transaction-line-items SQL marker missing");

  const baseWhere = baseConditions.join(" AND ");
  const branches = projectionDateClauses.map(
    (dateClause) => {
      const needsLineJoin = dateClause.includes("li.");
      const from = needsLineJoin
        ? `
               JOIN accounts.transaction_line_items li ON li.id = pm.line_item_id
               JOIN accounts.transactions t
                 ON t.id = li.transaction_id AND t.workspace_id = li.workspace_id`
        : "";
      const gate = needsLineJoin ? baseWhere : "pm.line_status != 'voided'";
      return `
             (
               SELECT pm.line_item_id AS id, pm.workspace_id, pm.combined_end
               FROM accounts.availment_chain_members pm
               ${from}
               WHERE pm.workspace_id = $1
                 AND ${gate}
                 AND ${dateClause.replaceAll("ag.combined_end", "pm.combined_end")}
               -- Candidate pagination is seekable; final display ordering is
               -- applied only after the bounded IDs are materialized.
               ORDER BY pm.line_item_id DESC
               LIMIT ${pageSize * 10}
             )`;
    },
  );
  const projectionPrefix = `WITH projection_candidates_raw AS (
             ${branches.join("\n             UNION ALL")}
           ), projection_candidates AS MATERIALIZED (
             SELECT DISTINCT ON (id, workspace_id) id, workspace_id, combined_end
             FROM projection_candidates_raw
             ORDER BY workspace_id, id
           ), line_combined_end AS MATERIALIZED (
             SELECT id, workspace_id, combined_end
             FROM projection_candidates
           ),`;
  const suffix = legacySql
    .slice(markerAt + "           ),".length)
    .replace("LEFT JOIN line_combined_end ag", "JOIN line_combined_end ag");
  return `${projectionPrefix}${suffix} LIMIT ${pageSize}`;
}

export function buildLineItemsRouter(deps: RouterDeps): Hono {
  const router = new Hono();
  const { db: pool, requireAuth, requireWorkspace, requirePermission } = deps;

  // Any successful write through this router changes board/capacity reads —
  // wake SSE subscribers and expire the capacity cache (lib/board-events.ts).
  router.use("*", async (c, next) => {
    await next();
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.res.status < 400) {
      const wsId = ctxGet(c, "workspaceId");
      if (wsId != null) bumpBoardVersion(wsId);
    }
  });

  // Admin/superuser bypass the per-row privacy gate. Mirrors the monolith's
  // canBypassTransactionPrivacy, resolved from the kernel-forwarded identity.
  const canBypassPrivacy = isWorkspaceElevated;

  // The SSE board-change stream (distinct literal path, ordering not load-bearing).
  registerLineItemEventsRoute(router, deps);
  // charge-overage + extend: both append a line and re-price the parent txn.
  registerLineItemExtendRoutes(router, deps);

  // ── GET /api/transaction-line-items ──────────────────────────────────────
  //
  // Lists line items with the parent transaction's client/payment context.
  //
  // Query params:
  //   active_on=YYYY-MM-DD (default: today, server timezone)
  //   include_carryover=true|false (default: true)
  //   include_today_transactions=true|false (default: true)
  //   include_upcoming=true|false (default: false)
  //   include_voided=true|false (default: false)
  //   status=comma-list — filter by line_item.status
  router.get(
    "/api/transaction-line-items",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c) => {
      if (!ctxGet(c, "workspaceId")) {
        return c.json({ error: "No workspace context" }, 403);
      }

      const activeOnRaw = (c.req.query("active_on") as string | undefined)?.trim();
      const includeCarryover = c.req.query("include_carryover") !== "false";
      const includeTodayTxns = c.req.query("include_today_transactions") !== "false";
      const includeUpcoming = c.req.query("include_upcoming") === "true";
      const includeVoided = c.req.query("include_voided") === "true";
      const requestedLimit = Number.parseInt(c.req.query("limit") ?? "", 10);
      const projectionMode =
        process.env.AVAILMENT_PROJECTION === "true" &&
        Number.isInteger(requestedLimit) &&
        requestedLimit > 0;
      const projectionPageSize = projectionMode ? Math.min(requestedLimit, 200) : 0;
      const statusList = (c.req.query("status") as string | undefined)
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      let activeOn: string;
      if (activeOnRaw && /^\d{4}-\d{2}-\d{2}$/.test(activeOnRaw)) {
        activeOn = activeOnRaw;
      } else {
        activeOn = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
      }

      const userId = ctxGet(c, "user")?.id;
      const params: (string | number | string[])[] = [];
      let idx = 1;
      const conditions: string[] = [];

      // Workspace isolation (line items carry workspace_id directly).
      conditions.push(`li.workspace_id = $${idx++}`);
      params.push(ctxGet(c, "workspaceId"));

      // Privacy: parent transaction must be public, owned, or shared.
      if (userId && !canBypassPrivacy(c)) {
        conditions.push(
          `(t.is_private = false OR t.created_by = $${idx} OR EXISTS (
             SELECT 1 FROM accounts.transaction_visibility tv
             WHERE tv.transaction_id = t.id AND tv.user_id = $${idx}
           ) OR EXISTS (
             SELECT 1 FROM accounts.transaction_visibility_role tvr
             WHERE tvr.transaction_id = t.id AND tvr.role_code = $${idx + 1}
           ))`,
        );
        params.push(userId, ctxGet(c, "wsRole") ?? "");
        idx += 2;
      }

      if (!includeVoided) {
        conditions.push(`t.status != 'voided'`);
      }

      const validStatuses = ["active", "completed", "expired", "voided"];
      const filteredStatuses = statusList?.filter((s) => validStatuses.includes(s));
      if (filteredStatuses && filteredStatuses.length > 0) {
        conditions.push(`li.status = ANY($${idx++}::text[])`);
        params.push(filteredStatuses);
      }

      // Projection candidates must apply every non-date gate before limiting.
      const baseConditions = [...conditions];

      // Date scope: OR group of (today's-transaction) and (active-carryover).
      const dateClauses: string[] = [];
      if (includeTodayTxns) {
        dateClauses.push(
          `(
             CASE
               WHEN li.started_at IS NULL THEN t.transaction_date
               ELSE COALESCE(
                 CASE
                   WHEN ag.combined_end > NOW() THEN t.transaction_date
                   WHEN ag.combined_end IS NOT NULL THEN (ag.combined_end AT TIME ZONE 'Asia/Manila')::date
                   WHEN li.ends_at > NOW() THEN t.transaction_date
                   WHEN li.ends_at IS NOT NULL THEN (li.ends_at AT TIME ZONE 'Asia/Manila')::date
                 END,
                 t.transaction_date
               )
             END
           ) = $${idx}::date`,
        );
      }
      if (includeCarryover) {
        dateClauses.push(
          `(li.started_at IS NOT NULL AND li.started_at < $${idx}::date AND EXISTS (
             SELECT 1 FROM accounts.transaction_line_items sib
              WHERE sib.transaction_id = li.transaction_id
                AND sib.workspace_id = li.workspace_id
                AND COALESCE(sib.client_id, -1) = COALESCE(li.client_id, -1)
                AND sib.status != 'voided'
                AND sib.ends_at IS NOT NULL AND sib.ends_at > NOW()
           ))`,
        );
        // Backdated-but-currently-running rescue. The natural-day CASE above
        // returns t.transaction_date for actively-running lines, so a charge
        // rung up with a yesterday transaction_date but a today started_at
        // (a backdated entry whose session is in progress NOW) falls through
        // both arms when the user filters for today: the CASE points at
        // yesterday, and the carryover arm above requires started_at <
        // today::date which a today-started session doesn't satisfy. Catch
        // these here so the live board always shows what's actually running.
        // Scoped to Manila today so older active_on dates don't accidentally
        // surface every currently-running session.
        //
        // Uses ag.combined_end instead of li.ends_at for items that are part
        // of a same-client subgroup (same transaction, same client, >=2 lines).
        // The subgroup's combined duration can extend beyond the individual
        // line's ends_at (e.g. one line is a flat-rate base, another is an
        // hourly extension), and the counter card always surfaces the combined
        // remaining time, so the rescue must match what the user sees.
        dateClauses.push(
          `(li.started_at IS NOT NULL
            AND li.ends_at IS NOT NULL
            AND li.started_at <= NOW()
            AND COALESCE(ag.combined_end, li.ends_at) > NOW()
            AND $${idx}::date = (NOW() AT TIME ZONE 'Asia/Manila')::date)`,
        );
        // Prepaid credits / non-time-bound items: started_at is NULL but the
        // item still has a future ends_at (validity window). The main CASE
        // buckets these by t.transaction_date, which may be in the past, so
        // they'd silently fall out of the today scope. Catch them here the
        // same way we catch backdated time-bound sessions.
        dateClauses.push(
          `(li.started_at IS NULL
            AND li.ends_at IS NOT NULL
            AND li.ends_at > NOW()
            AND li.status != 'voided'
            AND $${idx}::date >= (NOW() AT TIME ZONE 'Asia/Manila')::date)`,
        );
      }
      if (includeUpcoming) {
        dateClauses.push(
          `(li.started_at IS NOT NULL AND li.started_at > NOW() AND li.status != 'voided' AND $${idx}::date >= (NOW() AT TIME ZONE 'Asia/Manila')::date)`,
        );
      }
      if (dateClauses.length === 0) {
        return c.json({ data: [], active_on: activeOn });
      }
      conditions.push(`(${dateClauses.join(" OR ")})`);
      params.push(activeOn);

      // Candidate predicates stay index-friendly; the legacy date clauses
      // below remain the final correctness filter after the bounded page.
      const projectionDateClauses: string[] = [];
      if (includeTodayTxns) {
        projectionDateClauses.push(
          `(pm.transaction_date = $${idx}::date)`,
        );
        projectionDateClauses.push(
          `(pm.combined_end IS NOT NULL
            AND (pm.combined_end AT TIME ZONE 'Asia/Manila')::date = $${idx}::date)`,
        );
        projectionDateClauses.push(
          `(pm.combined_end IS NULL
            AND pm.line_ends_at IS NOT NULL
            AND (pm.line_ends_at AT TIME ZONE 'Asia/Manila')::date = $${idx}::date)`,
        );
      }
      if (includeCarryover) {
        projectionDateClauses.push(
          `(pm.combined_end IS NOT NULL AND pm.combined_end > NOW())`,
        );
        projectionDateClauses.push(
          `(li.started_at IS NOT NULL AND li.started_at < $${idx}::date AND EXISTS (
             SELECT 1 FROM accounts.transaction_line_items sib
              WHERE sib.transaction_id = li.transaction_id
                AND sib.workspace_id = li.workspace_id
                AND COALESCE(sib.client_id, -1) = COALESCE(li.client_id, -1)
                AND sib.status != 'voided'
                AND sib.ends_at IS NOT NULL AND sib.ends_at > NOW()
           ))`,
        );
        projectionDateClauses.push(
          `(li.started_at IS NULL AND li.ends_at IS NOT NULL AND li.ends_at > NOW())`,
        );
      }
      if (includeUpcoming) {
        projectionDateClauses.push(
          `(pm.line_started_at IS NOT NULL AND pm.line_started_at > NOW())`,
        );
      }

      const where = `WHERE ${conditions.join(" AND ")}`;
      const queryWhere = projectionMode ? `${where} AND ag.id IS NOT NULL` : where;

      try {
        const timingStart = performance.now();
        // availment_chain_flags/_ids detect a run of CONTINUOUS OCCUPANCY:
        // (transaction_id, workspace_id, client) only — package_id is
        // deliberately excluded because /extend explicitly allows binding a
        // continuation line to a different variant/package
        // (line-items-extend.ts), and cart-edit's "Add another block" takes
        // package_id from client-supplied items[]; keying on package_id
        // would split a genuine contiguous continuation into two 1-line
        // chains and re-create the vanish bug. A chain breaks only on a real
        // gap (started_at > previous ends_at, strictly) — equal-start,
        // equal-boundary, and overlapping lines all continue the chain, so
        // a base line + a same-NOW()-timestamped extension charged together
        // (insert-line-items.ts fixes started_at to one transaction-wide
        // NOW()) still combine. Every window orders by (started_at, ends_at,
        // id) — a total order — so tied started_at values compare
        // deterministically instead of against an arbitrary neighbour.
        // line_combined_end maps each qualifying line id straight to its
        // chain's combined_end so `matched` can join on li.id instead of a
        // multi-column composite key — plus a second arm for non-time-bound
        // siblings, which can't join the per-chain aggregate at all (they
        // have no duration_value/duration_unit to qualify), falling back to
        // their subgroup's latest chain via subgroup_combined_end.
        // destination_account_id is deliberately NOT part of the chain key:
        // it lives on accounts.transactions (one value per transaction_id),
        // so within a CTE already scoped to one transaction_id it can never
        // discriminate between siblings.
        const legacySql = `WITH availment_chain_flags AS (
             SELECT
               sib.id,
               sib.transaction_id,
               sib.workspace_id,
               COALESCE(sib.client_id, -1) AS client_key,
               sib.started_at,
               sib.ends_at,
               sib.duration_value,
               sib.duration_unit,
               sib.quantity,
               -- Frontier is the running MAX(ends_at) over every prior sibling,
               -- not just the immediately preceding row: a short line nested
               -- inside a longer still-covering one (e.g. a same-transaction
               -- add-on) must not reset the covered-until point for the next
               -- row. MAX ignores NULLs, so an open-ended (NULL ends_at)
               -- sibling contributes nothing to the frontier rather than
               -- forcing a break. The three CASE arms are NOT collapsible:
               -- an empty frame (COUNT = 0, genuine first row) starts a
               -- chain, but a non-empty frame whose frontier is NULL (every
               -- prior sibling open-ended) must NOT break — that predecessor
               -- can't prove a gap — so it has to be distinguished from the
               -- empty-frame case even though both yield MAX(ends_at) IS NULL.
               CASE
                 WHEN COUNT(*) OVER w = 0 THEN 1
                 WHEN MAX(sib.ends_at) OVER w IS NULL THEN 0
                 WHEN sib.started_at > MAX(sib.ends_at) OVER w THEN 1
                 ELSE 0
               END AS chain_break
             FROM accounts.transaction_line_items sib
             WHERE sib.workspace_id = $1
               AND sib.status != 'voided'
               AND sib.started_at IS NOT NULL
               AND sib.duration_value IS NOT NULL
               AND sib.duration_unit IS NOT NULL
             WINDOW w AS (
               PARTITION BY sib.transaction_id, sib.workspace_id, COALESCE(sib.client_id, -1)
               ORDER BY sib.started_at, sib.ends_at, sib.id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             )
           ), availment_chain_ids AS (
             SELECT
               id,
               transaction_id,
               workspace_id,
               client_key,
               started_at,
               ends_at,
               duration_value,
               duration_unit,
               quantity,
               -- running total of chain_break within the same partition/order
               -- as above turns each break into the start of a new chain id.
               SUM(chain_break) OVER (
                 PARTITION BY transaction_id, workspace_id, client_key
                 ORDER BY started_at, ends_at, id
                 ROWS UNBOUNDED PRECEDING
               ) AS chain_id
             FROM availment_chain_flags
           ), availment_chain_metrics AS (
             SELECT
               aci.*,
               (
                 MIN(started_at) OVER chain_window
                 + COALESCE(SUM(CASE WHEN duration_unit = 'hour'
                                          THEN duration_value * COALESCE(quantity, 1)
                                     END) OVER chain_window, 0) * INTERVAL '1 hour'
                 + COALESCE(SUM(CASE WHEN duration_unit = 'day'
                                          THEN duration_value * COALESCE(quantity, 1)
                                     END) OVER chain_window, 0) * INTERVAL '1 day'
                 + COALESCE(SUM(CASE WHEN duration_unit = 'month'
                                          THEN duration_value * COALESCE(quantity, 1)
                                     END) OVER chain_window, 0) * INTERVAL '1 month'
               ) AS combined_end,
               COUNT(*) OVER chain_window AS chain_size
             FROM availment_chain_ids aci
             WINDOW chain_window AS (
               PARTITION BY transaction_id, workspace_id, client_key, chain_id
             )
           ), availment_groups AS (
             SELECT DISTINCT
               transaction_id,
               workspace_id,
               client_key,
               chain_id,
               combined_end,
               chain_size
             FROM availment_chain_metrics
             -- NOTE: payment_count_by_txn and payment_methods_by_txn both scan
             -- accounts.transaction_payments. PostgreSQL may inline them into one
             -- pass; the separate CTEs are kept because the Method CTE needs
             -- ORDER BY first_at (MIN(created_at)) ordering that conflates with
             -- the unconditional COUNT(*) in a single aggregation. The planner
             -- handles this fine at current transaction volumes.

           ), subgroup_combined_end AS (
             -- One row per (transaction, workspace, client) subgroup that has
             -- at least one qualifying chain, collapsing multiple disjoint
             -- chains (the tx-7919 shape) to the latest-ending one — a
             -- non-time-bound sibling has no window of its own to disambiguate
             -- which chain it belongs to, so "most future" is the only
             -- deterministic choice.
             SELECT transaction_id, workspace_id, client_key, MAX(combined_end) AS combined_end
             FROM availment_groups
             WHERE chain_size >= 2
             GROUP BY transaction_id, workspace_id, client_key
           ), line_combined_end AS (
             SELECT id, workspace_id, combined_end
             FROM availment_chain_metrics
             WHERE chain_size >= 2
             UNION ALL
             -- Non-time-bound siblings (duration_value/duration_unit NULL —
             -- e.g. a retail add-on, insert-line-items.ts:121) are excluded
             -- from availment_chain_flags entirely, so they never join the
             -- per-chain aggregate above and would otherwise stop inheriting
             -- their subgroup's combined_end. ids are disjoint from the arm
             -- above (duration_value NULL vs NOT NULL), so no row for the
             -- same line id can come from both arms.
             SELECT sib.id, sib.workspace_id, sce.combined_end
             FROM accounts.transaction_line_items sib
             JOIN subgroup_combined_end sce
               ON sce.transaction_id = sib.transaction_id
              AND sce.workspace_id = sib.workspace_id
              AND sce.client_key = COALESCE(sib.client_id, -1)
             WHERE sib.workspace_id = $1
               AND sib.status != 'voided'
               AND (sib.duration_value IS NULL OR sib.duration_unit IS NULL)
           ), matched AS (
             SELECT
               li.id,
               li.transaction_id,
               li.workspace_id,
               li.package_id,
               li.package_variant_id,
               li.description AS line_description,
               li.quantity,
               li.unit_price,
               li.duration_value,
               li.duration_unit,
               li.started_at,
               li.ends_at,
               li.status AS line_status,
               li.created_at AS line_created_at,
               li.updated_at,
               t.transaction_date,
               t.amount AS transaction_amount,
               t.subtotal AS transaction_subtotal,
               t.discount_amount,
               t.notes,
               t.category,
               t.client_id,
               t.voucher_id,
               t.is_private,
               t.status AS transaction_status,
               t.batch_code AS transaction_batch_code,
               li.client_id AS line_client_id,
               t.source_account_id,
               t.destination_account_id,
               li.customer_group_id,
               cg.position AS customer_group_position,
               cg.display_name AS customer_group_display_name,
               cg.is_payer AS customer_group_is_payer,
               cg.client_id AS customer_group_client_id,
               cg.subtotal AS customer_group_subtotal,
               cg.voucher_id AS customer_group_voucher_id,
               cg.discount_amount AS customer_group_discount_amount
             FROM accounts.transaction_line_items li
             JOIN accounts.transactions t
               ON t.id = li.transaction_id AND t.workspace_id = li.workspace_id
             LEFT JOIN accounts.transaction_customer_groups cg ON cg.id = li.customer_group_id
             LEFT JOIN line_combined_end ag ON ag.id = li.id AND ag.workspace_id = li.workspace_id
             ${queryWhere}
           ), payment_count_by_txn AS (
             SELECT tp.transaction_id,
                    tp.workspace_id,
                    COUNT(*)::int AS payment_count
               FROM accounts.transaction_payments tp
              WHERE tp.workspace_id = $1
                AND tp.transaction_id IN (SELECT m.transaction_id FROM matched m)
              GROUP BY tp.transaction_id, tp.workspace_id
           ), payment_methods_by_txn AS (
              -- Distinct payment accounts per transaction, ordered by first use.
              -- Names + avatars resolve client-side from the accounts index so
              -- only the ids are carried. A split payment across two accounts
              -- (e.g. part GCash, part Cash) yields both, in pay order.
             SELECT transaction_id,
                    workspace_id,
                    array_agg(financial_account_id ORDER BY first_at) AS payment_account_ids
               FROM (
                 SELECT tp.transaction_id,
                        tp.workspace_id,
                        tp.financial_account_id,
                        MIN(tp.created_at) AS first_at
                   FROM accounts.transaction_payments tp
                  WHERE tp.workspace_id = $1
                    AND tp.financial_account_id IS NOT NULL
                    AND tp.transaction_id IN (SELECT m.transaction_id FROM matched m)
                  GROUP BY tp.transaction_id, tp.workspace_id, tp.financial_account_id
               ) distinct_accts
              GROUP BY transaction_id, workspace_id
           )
           SELECT
             m.id,
             m.transaction_id,
             m.package_id,
             m.package_variant_id,
             m.line_description,
             m.quantity,
             m.unit_price,
             m.duration_value,
             m.duration_unit,
             m.started_at,
             m.ends_at,
             m.line_status,
             m.line_created_at,
             m.updated_at,
             m.transaction_date,
             m.transaction_amount,
             m.transaction_subtotal,
             m.discount_amount,
             m.notes,
             m.category,
             m.client_id,
             m.voucher_id,
             m.is_private,
             m.transaction_status,
             m.transaction_batch_code,
             m.line_client_id,
             m.source_account_id,
             m.destination_account_id,
             m.customer_group_id,
             m.customer_group_position,
             m.customer_group_display_name,
             m.customer_group_is_payer,
             m.customer_group_client_id,
             m.customer_group_subtotal,
             m.customer_group_voucher_id,
             m.customer_group_discount_amount,
             COALESCE(pc.payment_count, 0) AS payment_count,
             COALESCE(pm.payment_account_ids, '{}') AS payment_account_ids
           FROM matched m
           LEFT JOIN payment_count_by_txn pc
             ON pc.transaction_id = m.transaction_id
            AND pc.workspace_id = m.workspace_id
           LEFT JOIN payment_methods_by_txn pm
             ON pm.transaction_id = m.transaction_id
            AND pm.workspace_id = m.workspace_id
           ORDER BY
             CASE WHEN m.line_status = 'active' AND m.ends_at IS NOT NULL THEN 0 ELSE 1 END,
             m.ends_at ASC NULLS LAST,
             m.transaction_date DESC,
             m.id DESC`;

        const result = await pool.query(
          projectionMode
            ? buildProjectionSql(
                legacySql,
                baseConditions,
                projectionDateClauses,
                projectionPageSize,
              )
            : legacySql,
          params,
        );
        if (process.env.AVAILMENT_TIMING === "true") {
          console.error("[availment-timing] mode", projectionMode, "sql rows", result.rows.length, Math.round(performance.now() - timingStart));
        }

        const idh = identityHeaderOf(c);

        // Resolve package + variant names over RPC (graceful: null when the
        // packages plugin is absent), mirroring the monolith's batch-fetch.
        const packageIds = [
          ...new Set(
            result.rows
              .map((r) => r.package_id as number | null)
              .filter((id): id is number => id != null),
          ),
        ];
        const variantIds = [
          ...new Set(
            result.rows
              .map((r) => r.package_variant_id as number | null)
              .filter((id): id is number => id != null),
          ),
        ];
        // Billed-to + per-line client names, and the per-transaction client
        // pool (resolved from accounts.transaction_customers + RPC names).
        const poolRows = await pool.query<{
          transaction_id: number;
          client_id: number;
          position: number;
        }>(
          `SELECT transaction_id, client_id, "position"
             FROM accounts.transaction_customers
            WHERE workspace_id = $1
              AND transaction_id = ANY($2::int[])
            ORDER BY transaction_id, "position" ASC, client_id ASC`,
          [
            ctxGet(c, "workspaceId"),
            [...new Set(result.rows.map((r) => r.transaction_id as number))],
          ],
        );
        if (process.env.AVAILMENT_TIMING === "true") {
          console.error("[availment-timing] pool rows", poolRows.rows.length, Math.round(performance.now() - timingStart));
        }
        const billedToIds = result.rows
          .map((r) => r.client_id as number | null)
          .filter((id): id is number => id != null);
        const lineClientIds = result.rows
          .map((r) => r.line_client_id as number | null)
          .filter((id): id is number => id != null);
        const clientIds = [
          ...new Set([
            ...billedToIds,
            ...lineClientIds,
            ...poolRows.rows.map((r) => r.client_id),
          ]),
        ];

        const [packages, variants, clients] = await Promise.all([
          packageIds.length > 0 ? findPackagesByIds(packageIds, idh) : Promise.resolve([]),
          variantIds.length > 0 ? findVariantsByIds(variantIds, idh) : Promise.resolve([]),
          clientIds.length > 0 ? findClientsByIds(clientIds, idh) : Promise.resolve([]),
        ]);
        if (process.env.AVAILMENT_TIMING === "true") {
          console.error("[availment-timing] peer batch", packageIds.length, variantIds.length, clientIds.length, Math.round(performance.now() - timingStart));
        }
        const packageNameById = new Map<number, string>((packages ?? []).map((p) => [p.id, p.name]));
        const variantById = new Map((variants ?? []).map((v) => [v.id, v]));
        const clientNameById = new Map<number, string>((clients ?? []).map((c) => [c.id, c.name]));

        // Effective voucher per row, matching repriceParentTransaction's
        // precedence: a customer-group row's OWN voucher_id wins whenever the
        // line belongs to a group (even if it's null — that's "no discount"),
        // otherwise the transaction-level voucher_id applies. The counter
        // Extend modal mirrors this against the effective subtotal/discount to
        // preview the post-extend charge without drifting from the server.
        const effectiveVoucherIds = [
          ...new Set(
            result.rows
              .map((r) =>
                r.customer_group_id != null
                  ? (r.customer_group_voucher_id as number | null)
                  : (r.voucher_id as number | null),
              )
              .filter((id): id is number => id != null),
          ),
        ];
        const voucherEntries = await Promise.all(
          effectiveVoucherIds.map(async (id) => [id, await findVoucherById(id, idh)] as const),
        );
        if (process.env.AVAILMENT_TIMING === "true") {
          console.error("[availment-timing] vouchers", effectiveVoucherIds.length, Math.round(performance.now() - timingStart));
        }
        const voucherById = new Map(voucherEntries);

        // Build the per-transaction client pool, in pool order. The counter UI
        // expects `{ id, name_raw }`; the RPC returns `name`, so we map it.
        const poolByTxn = new Map<number, Array<{ id: number; name_raw: string | null }>>();
        for (const r of poolRows.rows) {
          const arr = poolByTxn.get(r.transaction_id) ?? [];
          arr.push({ id: r.client_id, name_raw: clientNameById.get(r.client_id) ?? null });
          poolByTxn.set(r.transaction_id, arr);
        }

        const rows = result.rows.map((r) => {
          const variant =
            r.package_variant_id != null ? variantById.get(r.package_variant_id) : undefined;
          const effectiveVoucherId =
            r.customer_group_id != null
              ? (r.customer_group_voucher_id as number | null)
              : (r.voucher_id as number | null);
          const effectiveVoucher =
            effectiveVoucherId != null ? (voucherById.get(effectiveVoucherId) ?? null) : null;
          return {
            ...r,
            package_name: r.package_id != null ? (packageNameById.get(r.package_id) ?? null) : null,
            variant_name: variant?.name ?? null,
            variant_kind: variant?.kind ?? null,
            client_name: r.client_id != null ? (clientNameById.get(r.client_id) ?? null) : null,
            // Same dynamic-resolution rule as the detail endpoint:
            // customer_group_display_name prefers the live client name
            // when the group has a registered client. The stored
            // denormalized snapshot is only a fallback (walk-ins or
            // RPC-failure survival). This keeps the counter listing
            // responsive to client renames and client-swap edits.
            customer_group_display_name:
              r.customer_group_client_id != null ? (clientNameById.get(r.customer_group_client_id) ?? r.customer_group_display_name ?? null) : (r.customer_group_display_name ?? null),
            line_client_name:
              r.line_client_id != null ? (clientNameById.get(r.line_client_id) ?? null) : null,
            client_pool: poolByTxn.get(r.transaction_id) ?? [],
            // Resolved over a separate plugin's schema; left null in the fork
            // (see file header). Fields kept so the response shape matches.
            voucher_code: null,
            source_account_name: null,
            destination_account_name: null,
            effective_voucher: effectiveVoucher
              ? {
                  type: effectiveVoucher.type,
                  value: effectiveVoucher.value,
                  max_discount_amount: effectiveVoucher.max_discount_amount ?? null,
                }
              : null,
          };
        });

        return c.json({ data: rows, active_on: activeOn });
      } catch (err) {
        console.error("[transaction-line-items] list error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  // ── GET /api/transaction-line-items/active-subscriptions?client_id=N ─────
  //
  // The client's currently active monthly subscription packages, one row per
  // package (latest-ending line is source of truth). Used by the Counter cart
  // to surface a "Subscription Use" item. The monthly-type filter runs in JS
  // via the packages RPC — never a cross-schema join.
  router.get(
    "/api/transaction-line-items/active-subscriptions",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c) => {
      if (!ctxGet(c, "workspaceId")) {
        return c.json({ error: "No workspace context" }, 403);
      }
      const clientId = parseInt(String(c.req.query("client_id") ?? ""), 10);
      if (!Number.isFinite(clientId) || clientId <= 0) {
        return c.json({ error: "client_id is required" }, 400);
      }

      try {
        const result = await pool.query<{
          package_id: number;
          package_variant_id: number;
          ends_at: string;
        }>(
          `SELECT DISTINCT ON (li.package_id)
                  li.package_id,
                  li.package_variant_id,
                  li.ends_at
             FROM accounts.transaction_line_items li
             JOIN accounts.transactions t
               ON t.id = li.transaction_id
              AND t.workspace_id = li.workspace_id
            WHERE li.workspace_id = $1
              AND COALESCE(li.client_id, t.client_id) = $2
              AND li.status IN ('active', 'completed')
              AND li.ends_at > NOW()
              AND li.package_id IS NOT NULL
              AND li.package_variant_id IS NOT NULL
            ORDER BY li.package_id, li.ends_at DESC`,
          [ctxGet(c, "workspaceId"), clientId],
        );

        if (result.rows.length === 0) {
          return c.json({ data: [] });
        }

        const idh = identityHeaderOf(c);
        const packageIds = [...new Set(result.rows.map((r) => r.package_id))];
        const variantIds = [...new Set(result.rows.map((r) => r.package_variant_id))];
        const [packages, variants] = await Promise.all([
          findPackagesByIds(packageIds, idh),
          findVariantsByIds(variantIds, idh),
        ]);
        const monthlyById = new Map(
          (packages ?? []).filter((p) => p.type === "monthly").map((p) => [p.id, p]),
        );
        const variantById = new Map((variants ?? []).map((v) => [v.id, v]));

        const data = result.rows
          .map((r) => {
            const pkg = monthlyById.get(r.package_id);
            const variant = variantById.get(r.package_variant_id);
            if (!pkg || !variant) return null;
            return {
              package_id: r.package_id,
              package_name: pkg.name,
              package_variant_id: r.package_variant_id,
              variant_name: variant.name,
              ends_at: r.ends_at,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        return c.json({ data });
      } catch (err) {
        console.error("[transaction-line-items] active-subscriptions error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  // ── POST /api/transaction-line-items/:id/settle ──────────────────────────
  //
  // Marks an active or expired line item completed.
  // Body: { mode?: "as_is" | "backdated", ends_at?: string } (default: as_is)
  // Idempotent: a re-settle of an already-completed line 200s with the row.
  router.post(
    "/api/transaction-line-items/:id/settle",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      if (!ctxGet(c, "workspaceId")) {
        return c.json({ error: "No workspace context" }, 403);
      }
      const id = parseInt(c.req.param("id") as string);
      if (!id) {
        return c.json({ error: "id is required" }, 400);
      }
      const body = (await c.req.json() ?? {}) as { mode?: string; ends_at?: string };
      const mode = body.mode ?? "as_is";
      if (mode !== "as_is" && mode !== "backdated") {
        return c.json({ error: "mode must be 'as_is' or 'backdated'" }, 400);
      }

      let customEndsAt: Date | null = null;
      if (mode === "as_is" && body.ends_at != null) {
        if (typeof body.ends_at !== "string") {
          return c.json({ error: "ends_at must be an ISO timestamp string" }, 400);
        }
        const parsed = new Date(body.ends_at);
        if (isNaN(parsed.getTime())) {
          return c.json({ error: "ends_at is not a valid ISO timestamp" }, 400);
        }
        if (parsed.getTime() - Date.now() > 60_000) {
          return c.json({ error: "ends_at cannot be in the future" }, 400);
        }
        customEndsAt = parsed;
      }

      let bookedEnd: Date | null = null;
      if (customEndsAt) {
        const lineRes = await pool.query(
          `SELECT started_at, ends_at
             FROM accounts.transaction_line_items
            WHERE id = $1 AND workspace_id = $2 AND status IN ('active','expired')`,
          [id, ctxGet(c, "workspaceId")],
        );
        if (lineRes.rows.length === 0) {
          return c.json({ error: "Settleable line item not found in this workspace" }, 404);
        }
        const startedAt: Date | null = lineRes.rows[0].started_at
          ? new Date(lineRes.rows[0].started_at)
          : null;
        bookedEnd = lineRes.rows[0].ends_at ? new Date(lineRes.rows[0].ends_at) : null;
        if (startedAt && customEndsAt.getTime() <= startedAt.getTime()) {
          return c.json({ error: "ends_at must be after the rental's started_at" }, 400);
        }
      }

      // A backdated settle (or a custom ends_at that erases overage on an
      // already-overdue line) hides reporting evidence, so it sits behind the
      // transactions.backdate gate. Admin/superuser bypass via the forwarded
      // identity; otherwise check the forwarded permission set.
      const bookedEndAlreadyPassed = bookedEnd != null && bookedEnd.getTime() <= Date.now();
      const requiresBackdate =
        mode === "backdated" ||
        (customEndsAt != null &&
          bookedEnd != null &&
          bookedEndAlreadyPassed &&
          customEndsAt.getTime() < bookedEnd.getTime());
      if (requiresBackdate) {
        const allowed =
          isWorkspaceElevated(c) || (ctxGet(c, "permissions") ?? []).includes("transactions.backdate");
        if (!allowed) {
          return c.json({ error: "Missing permission: transactions.backdate" }, 403);
        }
      }

      try {
        let setClause: string;
        const params: unknown[] = [id, ctxGet(c, "workspaceId")];
        if (mode === "as_is") {
          if (customEndsAt) {
            setClause = `status = 'completed', ends_at = $3, updated_at = NOW()`;
            params.push(customEndsAt.toISOString());
          } else {
            setClause = `status = 'completed', ends_at = NOW(), updated_at = NOW()`;
          }
        } else {
          setClause = `status = 'completed', updated_at = NOW()`;
        }
        const result = await pool.query(
          `UPDATE accounts.transaction_line_items
              SET ${setClause}
            WHERE id = $1 AND workspace_id = $2 AND status IN ('active','expired')
            RETURNING ${LINE_ITEM_COLS.join(", ")}`,
          params,
        );
        if (result.rows.length === 0) {
          // Idempotency: an already-completed line 200s with its row so a
          // partial-failure retry from the counter Settle action doesn't error.
          const existing = await pool.query(
            `SELECT ${LINE_ITEM_COLS.join(", ")} FROM accounts.transaction_line_items
              WHERE id = $1 AND workspace_id = $2 AND status = 'completed'`,
            [id, ctxGet(c, "workspaceId")],
          );
          if (existing.rows.length > 0) {
            return c.json(existing.rows[0]);
          }
          return c.json({ error: "Settleable line item not found in this workspace" }, 404);
        }
        return c.json(result.rows[0]);
      } catch (err) {
        console.error("[transaction-line-items] settle error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  return router;
}
