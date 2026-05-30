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
//     req.permissions / req.orgRole instead of the monolith's async
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

import { Router, type Request, type Response } from "express";
import type { PluginDb } from "@ks-erp/kernel/services/database";
import { identityHeaderOf } from "@ks-erp/kernel/service-rpc";
import {
  findPackagesByIds,
  findVariantsByIds,
  findClientsByIds,
} from "./lib/peers.js";
import type { RouterDeps } from "./routes.js";

export function buildLineItemsRouter(deps: RouterDeps): Router {
  const router = Router();
  const { db: pool, requireAuth, requireOrg, requirePermission } = deps;

  // Admin/superuser bypass the per-row privacy gate. Mirrors the monolith's
  // canBypassTransactionPrivacy, resolved from the kernel-forwarded identity.
  const canBypassPrivacy = (req: Request): boolean =>
    req.orgRole === "admin" || req.user?.role === "superuser";

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
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      if (!req.organizationId) {
        res.status(403).json({ error: "No organization context" });
        return;
      }

      const activeOnRaw = (req.query.active_on as string | undefined)?.trim();
      const includeCarryover = req.query.include_carryover !== "false";
      const includeTodayTxns = req.query.include_today_transactions !== "false";
      const includeUpcoming = req.query.include_upcoming === "true";
      const includeVoided = req.query.include_voided === "true";
      const statusList = (req.query.status as string | undefined)
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      let activeOn: string;
      if (activeOnRaw && /^\d{4}-\d{2}-\d{2}$/.test(activeOnRaw)) {
        activeOn = activeOnRaw;
      } else {
        activeOn = new Date().toISOString().slice(0, 10);
      }

      const userId = req.user?.id;
      const params: (string | number | string[])[] = [];
      let idx = 1;
      const conditions: string[] = [];

      // Org isolation (line items carry organization_id directly).
      conditions.push(`li.organization_id = $${idx++}`);
      params.push(req.organizationId);

      // Privacy: parent transaction must be public, owned, or shared.
      if (userId && !canBypassPrivacy(req)) {
        conditions.push(
          `(t.is_private = false OR t.created_by = $${idx} OR EXISTS (
             SELECT 1 FROM accounts.transaction_visibility tv
             WHERE tv.transaction_id = t.id AND tv.user_id = $${idx}
           ) OR EXISTS (
             SELECT 1 FROM accounts.transaction_visibility_role tvr
             WHERE tvr.transaction_id = t.id AND tvr.role_code = $${idx + 1}
           ))`,
        );
        params.push(userId, req.orgRole ?? "");
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
                AND sib.organization_id = li.organization_id
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
        dateClauses.push(
          `(li.started_at IS NOT NULL
            AND li.ends_at IS NOT NULL
            AND li.started_at <= NOW()
            AND li.ends_at > NOW()
            AND $${idx}::date = (NOW() AT TIME ZONE 'Asia/Manila')::date)`,
        );
      }
      if (includeUpcoming) {
        dateClauses.push(
          `(li.started_at IS NOT NULL AND li.started_at > NOW() AND li.status != 'voided')`,
        );
      }
      if (dateClauses.length === 0) {
        res.json({ data: [], active_on: activeOn });
        return;
      }
      conditions.push(`(${dateClauses.join(" OR ")})`);
      params.push(activeOn);

      const where = `WHERE ${conditions.join(" AND ")}`;

      try {
        // availment_groups pre-aggregates the cross-day combined-end timestamp
        // once per (transaction_id, client_key) subgroup with >=2 time-bound,
        // non-voided siblings. payment_count_by_txn pre-counts payment legs.
        // The client pool is resolved via RPC below (clients.* is another
        // plugin's schema — never joined in raw SQL here).
        const result = await pool.query(
          `WITH availment_groups AS (
             SELECT
               sib.transaction_id,
               sib.organization_id,
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
             WHERE sib.organization_id = $1
               AND sib.status != 'voided'
               AND sib.started_at IS NOT NULL
               AND sib.duration_value IS NOT NULL
               AND sib.duration_unit IS NOT NULL
             GROUP BY sib.transaction_id, sib.organization_id, COALESCE(sib.client_id, -1)
             HAVING COUNT(*) >= 2
             -- NOTE: payment_count_by_txn and payment_methods_by_txn both scan
             -- accounts.transaction_payments. PostgreSQL may inline them into one
             -- pass; the separate CTEs are kept because the Method CTE needs
             -- ORDER BY first_at (MIN(created_at)) ordering that conflates with
             -- the unconditional COUNT(*) in a single aggregation. The planner
             -- handles this fine at current transaction volumes.

           ), payment_count_by_txn AS (
             SELECT tp.transaction_id,
                    tp.organization_id,
                    COUNT(*)::int AS payment_count
               FROM accounts.transaction_payments tp
              WHERE tp.organization_id = $1
              GROUP BY tp.transaction_id, tp.organization_id
           ), payment_methods_by_txn AS (
              -- Distinct payment accounts per transaction, ordered by first use.
              -- Names + avatars resolve client-side from the accounts index so
              -- only the ids are carried. A split payment across two accounts
              -- (e.g. part GCash, part Cash) yields both, in pay order.
             SELECT transaction_id,
                    organization_id,
                    array_agg(financial_account_id ORDER BY first_at) AS payment_account_ids
               FROM (
                 SELECT tp.transaction_id,
                        tp.organization_id,
                        tp.financial_account_id,
                        MIN(tp.created_at) AS first_at
                   FROM accounts.transaction_payments tp
                  WHERE tp.organization_id = $1
                    AND tp.financial_account_id IS NOT NULL
                  GROUP BY tp.transaction_id, tp.organization_id, tp.financial_account_id
               ) distinct_accts
              GROUP BY transaction_id, organization_id
           )
           SELECT
             li.id,
             li.transaction_id,
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
             cg.client_id AS customer_group_client_id,
             COALESCE(pc.payment_count, 0) AS payment_count,
             COALESCE(pm.payment_account_ids, '{}') AS payment_account_ids
           FROM accounts.transaction_line_items li
           JOIN accounts.transactions t ON t.id = li.transaction_id
           LEFT JOIN accounts.transaction_customer_groups cg ON cg.id = li.customer_group_id
           LEFT JOIN availment_groups ag
             ON ag.transaction_id = li.transaction_id
            AND ag.organization_id = li.organization_id
            AND ag.client_key = COALESCE(li.client_id, -1)
           LEFT JOIN payment_count_by_txn pc
             ON pc.transaction_id = li.transaction_id
            AND pc.organization_id = li.organization_id
           LEFT JOIN payment_methods_by_txn pm
             ON pm.transaction_id = li.transaction_id
            AND pm.organization_id = li.organization_id
           ${where}
           ORDER BY
             CASE WHEN li.status = 'active' AND li.ends_at IS NOT NULL THEN 0 ELSE 1 END,
             li.ends_at ASC NULLS LAST,
             t.transaction_date DESC,
             li.id DESC`,
          params,
        );

        const idh = identityHeaderOf(req);

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
            WHERE organization_id = $1
              AND transaction_id = ANY($2::int[])
            ORDER BY transaction_id, "position" ASC, client_id ASC`,
          [
            req.organizationId,
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

        res.json({ data: rows, active_on: activeOn });
      } catch (err) {
        console.error("[transaction-line-items] list error:", err);
        res.status(500).json({ error: "Internal server error" });
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
    requireOrg,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      if (!req.organizationId) {
        res.status(403).json({ error: "No organization context" });
        return;
      }
      const clientId = parseInt(String(req.query.client_id ?? ""), 10);
      if (!Number.isFinite(clientId) || clientId <= 0) {
        res.status(400).json({ error: "client_id is required" });
        return;
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
              AND t.organization_id = li.organization_id
            WHERE li.organization_id = $1
              AND COALESCE(li.client_id, t.client_id) = $2
              AND li.status IN ('active', 'completed')
              AND li.ends_at > NOW()
              AND li.package_id IS NOT NULL
              AND li.package_variant_id IS NOT NULL
            ORDER BY li.package_id, li.ends_at DESC`,
          [req.organizationId, clientId],
        );

        if (result.rows.length === 0) {
          res.json({ data: [] });
          return;
        }

        const idh = identityHeaderOf(req);
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

        res.json({ data });
      } catch (err) {
        console.error("[transaction-line-items] active-subscriptions error:", err);
        res.status(500).json({ error: "Internal server error" });
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
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      if (!req.organizationId) {
        res.status(403).json({ error: "No organization context" });
        return;
      }
      const id = parseInt(req.params.id as string);
      if (!id) {
        res.status(400).json({ error: "id is required" });
        return;
      }
      const body = (req.body ?? {}) as { mode?: string; ends_at?: string };
      const mode = body.mode ?? "as_is";
      if (mode !== "as_is" && mode !== "backdated") {
        res.status(400).json({ error: "mode must be 'as_is' or 'backdated'" });
        return;
      }

      let customEndsAt: Date | null = null;
      if (mode === "as_is" && body.ends_at != null) {
        if (typeof body.ends_at !== "string") {
          res.status(400).json({ error: "ends_at must be an ISO timestamp string" });
          return;
        }
        const parsed = new Date(body.ends_at);
        if (isNaN(parsed.getTime())) {
          res.status(400).json({ error: "ends_at is not a valid ISO timestamp" });
          return;
        }
        if (parsed.getTime() - Date.now() > 60_000) {
          res.status(400).json({ error: "ends_at cannot be in the future" });
          return;
        }
        customEndsAt = parsed;
      }

      let bookedEnd: Date | null = null;
      if (customEndsAt) {
        const lineRes = await pool.query(
          `SELECT started_at, ends_at
             FROM accounts.transaction_line_items
            WHERE id = $1 AND organization_id = $2 AND status IN ('active','expired')`,
          [id, req.organizationId],
        );
        if (lineRes.rows.length === 0) {
          res.status(404).json({ error: "Settleable line item not found in this organization" });
          return;
        }
        const startedAt: Date | null = lineRes.rows[0].started_at
          ? new Date(lineRes.rows[0].started_at)
          : null;
        bookedEnd = lineRes.rows[0].ends_at ? new Date(lineRes.rows[0].ends_at) : null;
        if (startedAt && customEndsAt.getTime() <= startedAt.getTime()) {
          res.status(400).json({ error: "ends_at must be after the rental's started_at" });
          return;
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
        const isAdmin = req.user?.role === "superuser" || req.orgRole === "admin";
        const allowed = isAdmin || (req.permissions ?? []).includes("transactions.backdate");
        if (!allowed) {
          res.status(403).json({ error: "Missing permission: transactions.backdate" });
          return;
        }
      }

      try {
        let setClause: string;
        const params: unknown[] = [id, req.organizationId];
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
            WHERE id = $1 AND organization_id = $2 AND status IN ('active','expired')
            RETURNING *`,
          params,
        );
        if (result.rows.length === 0) {
          // Idempotency: an already-completed line 200s with its row so a
          // partial-failure retry from the counter Settle action doesn't error.
          const existing = await pool.query(
            `SELECT * FROM accounts.transaction_line_items
              WHERE id = $1 AND organization_id = $2 AND status = 'completed'`,
            [id, req.organizationId],
          );
          if (existing.rows.length > 0) {
            res.json(existing.rows[0]);
            return;
          }
          res.status(404).json({ error: "Settleable line item not found in this organization" });
          return;
        }
        res.json(result.rows[0]);
      } catch (err) {
        console.error("[transaction-line-items] settle error:", err);
        res.status(500).json({ error: "Internal server error" });
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
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      if (!req.organizationId || !req.user?.id) {
        res.status(403).json({ error: "No organization context" });
        return;
      }
      const id = parseInt(req.params.id as string);
      if (!id) {
        res.status(400).json({ error: "id is required" });
        return;
      }
      const { package_variant_id, quantity } = req.body as {
        package_variant_id?: number;
        quantity?: number;
      };
      if (typeof package_variant_id !== "number" || package_variant_id <= 0) {
        res.status(400).json({ error: "package_variant_id is required" });
        return;
      }
      if (typeof quantity !== "number" || quantity <= 0) {
        res.status(400).json({ error: "quantity must be > 0" });
        return;
      }

      const idh = identityHeaderOf(req);
      let client: import("pg").PoolClient | null = null;
      try {
        client = await pool.connect();
        await client.query("BEGIN");

        const srcRes = await client.query(
          `SELECT id, transaction_id, ends_at, client_id, status, customer_group_id
             FROM accounts.transaction_line_items
            WHERE id = $1 AND organization_id = $2
            FOR UPDATE`,
          [id, req.organizationId],
        );
        if (srcRes.rows.length === 0) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "Line item not found in this organization" });
          return;
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
          res.status(409).json({ error: "Line item is not active or expired" });
          return;
        }
        if (src.ends_at == null || new Date(src.ends_at).getTime() > Date.now()) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: "charge-overage is only valid for overdue line items" });
          return;
        }

        const variants = await findVariantsByIds([package_variant_id], idh);
        const variant = variants?.[0];
        if (variant == null) {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "package_variant_id must belong to this organization" });
          return;
        }
        if (variant.duration_value == null) {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "package_variant has no duration_value" });
          return;
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
             (transaction_id, organization_id, package_id, package_variant_id,
              description, quantity, unit_price, duration_value, duration_unit,
              started_at, ends_at, status, client_id, customer_group_id)
           VALUES ($1, $2, $3, $4,
                   $5, $6, $9, $10, $11,
                   $8::timestamptz, $8::timestamptz + ${intervalExpr},
                   'completed', $12, $13)
           RETURNING *`,
          [
            src.transaction_id,
            req.organizationId,
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
            WHERE id = $3 AND organization_id = $4`,
          [extensionCost, req.user.id, src.transaction_id, req.organizationId],
        );

        if (src.customer_group_id != null) {
          await client.query(
            `UPDATE accounts.transaction_customer_groups
                SET subtotal = subtotal + $1
              WHERE id = $2 AND organization_id = $3`,
            [extensionCost, src.customer_group_id, req.organizationId],
          );
        }

        await client.query("COMMIT");
        res.status(201).json({
          source: src,
          overage_line: insertResult.rows[0],
        });
      } catch (err) {
        if (client) {
          await client.query("ROLLBACK").catch(() => {});
        }
        console.error("[transaction-line-items] charge-overage error:", err);
        res.status(500).json({ error: "Internal server error" });
      } finally {
        if (client) client.release();
      }
    },
  );

  // ── POST /api/transaction-line-items/:id/extend ──────────────────────────
  //
  // Appends a new 'active' line to the same parent transaction extending the
  // rental by quantity units of the picked variant. started_at chains off the
  // source's end (or NOW if it already passed). Bumps the parent transaction
  // (and cg subtotal) by the extension cost.
  // Body: { package_variant_id: number, quantity: number }
  router.post(
    "/api/transaction-line-items/:id/extend",
    requireAuth,
    requireOrg,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      if (!req.organizationId || !req.user?.id) {
        res.status(403).json({ error: "No organization context" });
        return;
      }
      const id = parseInt(req.params.id as string);
      if (!id) {
        res.status(400).json({ error: "id is required" });
        return;
      }
      const { package_variant_id, quantity } = req.body as {
        package_variant_id?: number;
        quantity?: number;
      };
      if (typeof package_variant_id !== "number" || package_variant_id <= 0) {
        res.status(400).json({ error: "package_variant_id is required" });
        return;
      }
      if (typeof quantity !== "number" || quantity <= 0) {
        res.status(400).json({ error: "quantity must be > 0" });
        return;
      }

      const idh = identityHeaderOf(req);
      let client: import("pg").PoolClient | null = null;
      try {
        client = await pool.connect();
        await client.query("BEGIN");

        const srcRes = await client.query(
          `SELECT id, transaction_id, package_id, ends_at, client_id, customer_group_id
             FROM accounts.transaction_line_items
            WHERE id = $1 AND organization_id = $2
            FOR UPDATE`,
          [id, req.organizationId],
        );
        if (srcRes.rows.length === 0) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "Line item not found in this organization" });
          return;
        }
        const src = srcRes.rows[0] as {
          id: number;
          transaction_id: number;
          package_id: number;
          ends_at: Date | null;
          client_id: number | null;
          customer_group_id: number | null;
        };

        // Variant must belong to the same org (resolved over RPC), but NOT
        // necessarily the source's package — cross-package extends are allowed.
        const variants = await findVariantsByIds([package_variant_id], idh);
        const variant = variants?.[0];
        if (variant == null) {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "package_variant_id must belong to this organization" });
          return;
        }
        if (variant.duration_value == null) {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "package_variant has no duration_value" });
          return;
        }

        const durationValue = parseFloat(String(variant.duration_value));
        const unitPrice = parseFloat(String(variant.price ?? 0));
        const totalUnits = durationValue * quantity;
        const extensionCost = unitPrice * quantity;

        const startFromPrevious =
          src.ends_at != null && new Date(src.ends_at).getTime() > Date.now();

        const intervalExpr =
          variant.duration_unit === "hour"
            ? "make_interval(hours => $7)"
            : variant.duration_unit === "day"
              ? "make_interval(days => $7)"
              : "make_interval(months => $7)";

        // $8 must appear (with an explicit cast) on both paths or Postgres
        // rejects the parse with 42P18. COALESCE keeps the NOW() fallback when
        // the source already elapsed.
        const startedAtExpr = "COALESCE($8::timestamptz, NOW())";

        const insertResult = await client.query(
          `INSERT INTO accounts.transaction_line_items
             (transaction_id, organization_id, package_id, package_variant_id,
              description, quantity, unit_price, duration_value, duration_unit,
              started_at, ends_at, status, client_id, customer_group_id)
           VALUES ($1, $2, $3, $4,
                   $5, $6, $9, $10, $11,
                   ${startedAtExpr}, ${startedAtExpr} + ${intervalExpr},
                   'active', $12, $13)
           RETURNING *`,
          [
            src.transaction_id,
            req.organizationId,
            variant.package_id,
            package_variant_id,
            variant.name,
            quantity,
            totalUnits,
            startFromPrevious ? src.ends_at : null,
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
            WHERE id = $3 AND organization_id = $4`,
          [extensionCost, req.user.id, src.transaction_id, req.organizationId],
        );

        if (src.customer_group_id != null) {
          await client.query(
            `UPDATE accounts.transaction_customer_groups
                SET subtotal = subtotal + $1
              WHERE id = $2 AND organization_id = $3`,
            [extensionCost, src.customer_group_id, req.organizationId],
          );
        }

        await client.query("COMMIT");
        res.status(201).json(insertResult.rows[0]);
      } catch (err) {
        if (client) {
          await client.query("ROLLBACK").catch(() => {});
        }
        console.error("[transaction-line-items] extend error:", err);
        res.status(500).json({ error: "Internal server error" });
      } finally {
        if (client) client.release();
      }
    },
  );

  return router;
}
