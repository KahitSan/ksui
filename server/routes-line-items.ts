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
import { applyTenantContext } from "@kahitsan/plugin-sdk";
import { identityHeaderOf } from "@kahitsan/plugin-sdk";
import {
  findPackagesByIds,
  findVariantsByIds,
  findClientsByIds,
} from "./lib/peers.js";
import type { RouterDeps } from "./routes.js";
import { ctxGet, isWorkspaceElevated } from "./types.js";

export function buildLineItemsRouter(deps: RouterDeps): Hono {
  const router = new Hono();
  const { db: pool, requireAuth, requireWorkspace, requirePermission } = deps;

  // Admin/superuser bypass the per-row privacy gate. Mirrors the monolith's
  // canBypassTransactionPrivacy, resolved from the kernel-forwarded identity.
  const canBypassPrivacy = isWorkspaceElevated;

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

      const where = `WHERE ${conditions.join(" AND ")}`;

      try {
        // availment_groups pre-aggregates the cross-day combined-end timestamp
        // once per (transaction_id, client_key) subgroup with >=2 time-bound,
        // non-voided siblings. The date filter reads ag.combined_end, so the
        // filtering happens in `matched`; the payment CTEs are projection-only
        // and scope to matched transactions instead of aggregating the whole
        // workspace history (they were the dominant cost at prod volumes).
        // The client pool is resolved via RPC below (clients.* is another
        // plugin's schema — never joined in raw SQL here).
        const result = await pool.query(
          `WITH availment_groups AS (
             SELECT
               sib.transaction_id,
               sib.workspace_id,
               COALESCE(sib.client_id, -1) AS client_key,
               (
                 MIN(sib.started_at)
                 + COALESCE(SUM(CASE WHEN sib.duration_unit = 'hour'
                                          THEN sib.duration_value * COALESCE(sib.quantity, 1)
                                     END), 0) * INTERVAL '1 hour'
                 + COALESCE(SUM(CASE WHEN sib.duration_unit = 'day'
                                          THEN sib.duration_value * COALESCE(sib.quantity, 1)
                                     END), 0) * INTERVAL '1 day'
                 + COALESCE(SUM(CASE WHEN sib.duration_unit = 'month'
                                          THEN sib.duration_value * COALESCE(sib.quantity, 1)
                                     END), 0) * INTERVAL '1 month'
               ) AS combined_end
             FROM accounts.transaction_line_items sib
             WHERE sib.workspace_id = $1
               AND sib.status != 'voided'
               AND sib.started_at IS NOT NULL
               AND sib.duration_value IS NOT NULL
               AND sib.duration_unit IS NOT NULL
             GROUP BY sib.transaction_id, sib.workspace_id, COALESCE(sib.client_id, -1)
             HAVING COUNT(*) >= 2
             -- NOTE: payment_count_by_txn and payment_methods_by_txn both scan
             -- accounts.transaction_payments. PostgreSQL may inline them into one
             -- pass; the separate CTEs are kept because the Method CTE needs
             -- ORDER BY first_at (MIN(created_at)) ordering that conflates with
             -- the unconditional COUNT(*) in a single aggregation. The planner
             -- handles this fine at current transaction volumes.

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
               cg.client_id AS customer_group_client_id
             FROM accounts.transaction_line_items li
             JOIN accounts.transactions t
               ON t.id = li.transaction_id AND t.workspace_id = li.workspace_id
             LEFT JOIN accounts.transaction_customer_groups cg ON cg.id = li.customer_group_id
             LEFT JOIN availment_groups ag
               ON ag.transaction_id = li.transaction_id
              AND ag.workspace_id = li.workspace_id
              AND ag.client_key = COALESCE(li.client_id, -1)
             ${where}
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
             m.id DESC`,
          params,
        );

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
        const packageNameById = new Map<number, string>((packages ?? []).map((p) => [p.id, p.name]));
        const variantById = new Map((variants ?? []).map((v) => [v.id, v]));
        const clientNameById = new Map<number, string>((clients ?? []).map((c) => [c.id, c.name]));

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
            RETURNING *`,
          params,
        );
        if (result.rows.length === 0) {
          // Idempotency: an already-completed line 200s with its row so a
          // partial-failure retry from the counter Settle action doesn't error.
          const existing = await pool.query(
            `SELECT * FROM accounts.transaction_line_items
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

  // ── POST /api/transaction-line-items/:id/charge-overage ──────────────────
  //
  // Charges the customer for time past a rental's booked end. Appends a new
  // 'completed' line covering the past overage window and bumps the parent
  // transaction (and the cg subtotal) by its cost. The source line stays
  // 'active'; the caller settles it separately.
  // Body: { package_variant_id: number, quantity: number }
  router.post(
    "/api/transaction-line-items/:id/charge-overage",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      if (!ctxGet(c, "workspaceId") || !ctxGet(c, "user")?.id) {
        return c.json({ error: "No workspace context" }, 403);
      }
      const id = parseInt(c.req.param("id") as string);
      if (!id) {
        return c.json({ error: "id is required" }, 400);
      }
      const { package_variant_id, quantity } = await c.req.json() as {
        package_variant_id?: number;
        quantity?: number;
      };
      if (typeof package_variant_id !== "number" || package_variant_id <= 0) {
        return c.json({ error: "package_variant_id is required" }, 400);
      }
      if (typeof quantity !== "number" || quantity <= 0) {
        return c.json({ error: "quantity must be > 0" }, 400);
      }

      const idh = identityHeaderOf(c);
      let client: import("pg").PoolClient | null = null;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await applyTenantContext(client);

        const srcRes = await client.query(
          `SELECT id, transaction_id, ends_at, client_id, status, customer_group_id
             FROM accounts.transaction_line_items
            WHERE id = $1 AND workspace_id = $2
            FOR UPDATE`,
          [id, ctxGet(c, "workspaceId")],
        );
        if (srcRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return c.json({ error: "Line item not found in this workspace" }, 404);
        }
        const src = srcRes.rows[0] as {
          id: number;
          transaction_id: number;
          ends_at: Date | null;
          client_id: number | null;
          status: string;
          customer_group_id: number | null;
        };
        if (src.status !== "active" && src.status !== "expired") {
          await client.query("ROLLBACK");
          return c.json({ error: "Line item is not active or expired" }, 409);
        }
        if (src.ends_at == null || new Date(src.ends_at).getTime() > Date.now()) {
          await client.query("ROLLBACK");
          return c.json({ error: "charge-overage is only valid for overdue line items" }, 409);
        }

        const variants = await findVariantsByIds([package_variant_id], idh);
        const variant = variants?.[0];
        if (variant == null) {
          await client.query("ROLLBACK");
          return c.json({ error: "package_variant_id must belong to this workspace" }, 400);
        }
        if (variant.duration_value == null) {
          await client.query("ROLLBACK");
          return c.json({ error: "package_variant has no duration_value" }, 400);
        }

        const durationValue = parseFloat(String(variant.duration_value));
        const unitPrice = parseFloat(String(variant.price ?? 0));
        const totalUnits = durationValue * quantity;
        const extensionCost = unitPrice * quantity;

        const intervalExpr =
          variant.duration_unit === "hour"
            ? "make_interval(hours => $7)"
            : variant.duration_unit === "day"
              ? "make_interval(days => $7)"
              : "make_interval(months => $7)";

        const insertResult = await client.query(
          `INSERT INTO accounts.transaction_line_items
             (transaction_id, workspace_id, package_id, package_variant_id,
              description, quantity, unit_price, duration_value, duration_unit,
              started_at, ends_at, status, client_id, customer_group_id)
           VALUES ($1, $2, $3, $4,
                   $5, $6, $9, $10, $11,
                   $8::timestamptz, $8::timestamptz + ${intervalExpr},
                   'completed', $12, $13)
           RETURNING *`,
          [
            src.transaction_id,
            ctxGet(c, "workspaceId"),
            variant.package_id,
            package_variant_id,
            variant.name,
            quantity,
            totalUnits,
            src.ends_at,
            unitPrice,
            durationValue,
            variant.duration_unit,
            src.client_id,
            src.customer_group_id,
          ],
        );

        await client.query(
          `UPDATE accounts.transactions
              SET amount = amount + $1, subtotal = COALESCE(subtotal, amount) + $1, updated_at = NOW(), updated_by = $2
            WHERE id = $3 AND workspace_id = $4`,
          [extensionCost, ctxGet(c, "user").id, src.transaction_id, ctxGet(c, "workspaceId")],
        );

        if (src.customer_group_id != null) {
          await client.query(
            `UPDATE accounts.transaction_customer_groups
                SET subtotal = subtotal + $1
              WHERE id = $2 AND workspace_id = $3`,
            [extensionCost, src.customer_group_id, ctxGet(c, "workspaceId")],
          );
        }

        await client.query("COMMIT");
        return c.json({
          source: src,
          overage_line: insertResult.rows[0],
        });
      } catch (err) {
        if (client) {
          await client.query("ROLLBACK").catch(() => {});
        }
        console.error("[transaction-line-items] charge-overage error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (client) client.release();
      }
    },
  );

  // ── POST /api/transaction-line-items/:id/extend ──────────────────────────
  //
  // Appends a new 'active' line to the same parent transaction extending the
  // rental by quantity units of the picked variant. started_at always chains
  // off the source's ends_at so the counter UI can link the lines into a
  // single entry. Bumps the parent transaction (and cg subtotal) by the
  // extension cost.
  // Body: { package_variant_id: number, quantity: number }
  router.post(
    "/api/transaction-line-items/:id/extend",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      if (!ctxGet(c, "workspaceId") || !ctxGet(c, "user")?.id) {
        return c.json({ error: "No workspace context" }, 403);
      }
      const id = parseInt(c.req.param("id") as string);
      if (!id) {
        return c.json({ error: "id is required" }, 400);
      }
      const { package_variant_id, quantity } = await c.req.json() as {
        package_variant_id?: number;
        quantity?: number;
      };
      if (typeof package_variant_id !== "number" || package_variant_id <= 0) {
        return c.json({ error: "package_variant_id is required" }, 400);
      }
      if (typeof quantity !== "number" || quantity <= 0) {
        return c.json({ error: "quantity must be > 0" }, 400);
      }

      const idh = identityHeaderOf(c);
      let client: import("pg").PoolClient | null = null;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await applyTenantContext(client);

        const srcRes = await client.query(
          `SELECT id, transaction_id, package_id, ends_at, client_id, customer_group_id
             FROM accounts.transaction_line_items
            WHERE id = $1 AND workspace_id = $2
            FOR UPDATE`,
          [id, ctxGet(c, "workspaceId")],
        );
        if (srcRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return c.json({ error: "Line item not found in this workspace" }, 404);
        }
        const src = srcRes.rows[0] as {
          id: number;
          transaction_id: number;
          package_id: number;
          ends_at: Date | null;
          client_id: number | null;
          customer_group_id: number | null;
        };

        // Variant must belong to the same workspace (resolved over RPC), but NOT
        // necessarily the source's package — cross-package extends are allowed.
        const variants = await findVariantsByIds([package_variant_id], idh);
        const variant = variants?.[0];
        if (variant == null) {
          await client.query("ROLLBACK");
          return c.json({ error: "package_variant_id must belong to this workspace" }, 400);
        }
        if (variant.duration_value == null) {
          await client.query("ROLLBACK");
          return c.json({ error: "package_variant has no duration_value" }, 400);
        }

        const durationValue = parseFloat(String(variant.duration_value));
        const unitPrice = parseFloat(String(variant.price ?? 0));
        const totalUnits = durationValue * quantity;
        const extensionCost = unitPrice * quantity;

        const intervalExpr =
          variant.duration_unit === "hour"
            ? "make_interval(hours => $7)"
            : variant.duration_unit === "day"
              ? "make_interval(days => $7)"
              : "make_interval(months => $7)";

        // Chain the extension off the source's ends_at so the counter UI can
        // link the lines into a single entry. When ends_at is null (shouldn't
        // happen for rentals) fall back to NOW().
        const startedAtExpr = "COALESCE($8::timestamptz, NOW())";

        const insertResult = await client.query(
          `INSERT INTO accounts.transaction_line_items
             (transaction_id, workspace_id, package_id, package_variant_id,
              description, quantity, unit_price, duration_value, duration_unit,
              started_at, ends_at, status, client_id, customer_group_id)
           VALUES ($1, $2, $3, $4,
                   $5, $6, $9, $10, $11,
                   ${startedAtExpr}, ${startedAtExpr} + ${intervalExpr},
                   'active', $12, $13)
           RETURNING *`,
          [
            src.transaction_id,
            ctxGet(c, "workspaceId"),
            variant.package_id,
            package_variant_id,
            variant.name,
            quantity,
            totalUnits,
            src.ends_at ?? null,
            unitPrice,
            durationValue,
            variant.duration_unit,
            src.client_id,
            src.customer_group_id,
          ],
        );

        await client.query(
          `UPDATE accounts.transactions
              SET amount = amount + $1, subtotal = COALESCE(subtotal, amount) + $1, updated_at = NOW(), updated_by = $2
            WHERE id = $3 AND workspace_id = $4`,
          [extensionCost, ctxGet(c, "user").id, src.transaction_id, ctxGet(c, "workspaceId")],
        );

        if (src.customer_group_id != null) {
          await client.query(
            `UPDATE accounts.transaction_customer_groups
                SET subtotal = subtotal + $1
              WHERE id = $2 AND workspace_id = $3`,
            [extensionCost, src.customer_group_id, ctxGet(c, "workspaceId")],
          );
        }

        await client.query("COMMIT");
        return c.json(insertResult.rows[0], 201);
      } catch (err) {
        if (client) {
          await client.query("ROLLBACK").catch(() => {});
        }
        console.error("[transaction-line-items] extend error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (client) client.release();
      }
    },
  );

  return router;
}
