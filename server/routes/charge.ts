// Counter-board reads + the POS charge flow for the transactions router.
//
// GET /outstanding (unpaid sales for the Counter board) and POST /charge (the
// POS charge flow, a thin wrapper over runCharge). Extracted verbatim from
// routes.ts so the per-resource route modules can share one source of truth.
// registerChargeRoutes mounts them onto the passed router under the same paths
// and middleware chain; the call site in buildRouter registers them in the same
// position as before — ahead of "/:id" so the literal segments win.
//
// Cross-plugin data (package/client names) is resolved over the kernel RPC with
// graceful degradation. privacyClause + org-scoping are unchanged.

import { type Router, type Request, type Response, type RequestHandler } from "express";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { identityHeaderOf } from "@kahitsan/plugin-sdk-composite";
import { findPackagesByIds, findClientsByIds } from "../lib/peers.js";
import { runCharge, ChargeValidationError, type ChargePayload } from "../helpers-charge.js";
import { privacyClause } from "./shared.js";

export type ChargeRouteCtx = {
  pool: PluginDb;
  requireAuth: RequestHandler;
  requireWorkspace: RequestHandler;
  requirePermission: (...codes: string[]) => RequestHandler;
};

export function registerChargeRoutes(router: Router, ctx: ChargeRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  // ── Outstanding (unpaid sales) — Counter board ──────────────────────────
  router.get(
    "/outstanding",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const params: unknown[] = [req.workspaceId];
        const conditions = [
          "t.workspace_id = $1",
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
    requireWorkspace,
    requirePermission("transactions.create"),
    async (req: Request, res: Response) => {
      if (!req.workspaceId || !req.user?.id) {
        res.status(400).json({ error: "Organization and user context required" });
        return;
      }
      try {
        const result = await runCharge({
          pool,
          workspaceId: req.workspaceId,
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
}
