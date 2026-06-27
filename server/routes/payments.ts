// Payment (settlement-leg) routes for the transactions router.
//
// The four payment handlers — PUT /:id/payments/:paymentId (edit a leg),
// GET /:id/payments (list legs), POST /:id/payments (add a leg), and
// DELETE /:id/payments/:paymentId (remove a leg). Extracted verbatim from
// routes.ts so the per-resource route modules share one source of truth.
//
// The PUT edit route was historically registered ahead of the analytics/charge
// reads, while the GET/POST/DELETE trio sat after the visibility route. To
// preserve the exact Express match order, the edit route is registered via
// registerPaymentUpdateRoute (early slot) and the remaining three via
// registerPaymentRoutes (later slot). Workspace scoping is preserved either way:
// the routes migrated onto makeDataSurface inject `AND workspace_id` from the
// ambient tenant context, and the routes still on raw db.query / escapeHatch keep
// their explicit `AND workspace_id = $N` filter.

import { type Router, type Request, type Response, type RequestHandler } from "express";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { identityHeaderOf, makeDataSurface } from "@kahitsan/plugin-sdk";
import { findAccountsByIds } from "../lib/peers.js";

export type PaymentRouteCtx = {
  pool: PluginDb;
  requireAuth: RequestHandler;
  requireWorkspace: RequestHandler;
  requirePermission: (...codes: string[]) => RequestHandler;
};

// Explicit column list for a payment leg row — the data surface bans `SELECT *`/
// `RETURNING *`, and these are the exact columns the create handler returned via
// `RETURNING *` (the table has no secret columns). Kept byte-identical so the
// add-leg response shape is preserved.
const PAYMENT_COLS = [
  "id",
  "transaction_id",
  "workspace_id",
  "financial_account_id",
  "amount",
  "notes",
  "created_at",
  "updated_at",
  "customer_group_id",
] as const;

// The PUT edit-leg route. Kept separate so it registers in the same early
// position it held in routes.ts (ahead of the analytics/charge reads).
export function registerPaymentUpdateRoute(router: Router, ctx: PaymentRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;
  const data = makeDataSurface(pool);

  router.put(
    "/:id/payments/:paymentId",
    requireAuth,
    requireWorkspace,
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
        // The surface injects `AND workspace_id = <ctx>`; the route's id +
        // transaction_id scoping stays in the user WHERE. Returns [] (→ 404)
        // when no row matches in this workspace.
        const rows = await data.update(
          "transaction_payments",
          { financial_account_id, amount: parsed },
          { where: "id = $1 AND transaction_id = $2", params: [req.params.paymentId, req.params.id] },
          PAYMENT_COLS,
        );
        if (rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        const payment = rows[0] as Record<string, unknown> & { financial_account_id: number | null };
        if (payment.financial_account_id != null) {
          const idh = (c.req.raw.headers.get("x-kserp-identity") ?? undefined);
          const accounts = await findAccountsByIds([payment.financial_account_id], idh);
          payment.financial_account_name = accounts?.[0]?.name ?? null;
        }
        res.json(payment);
      } catch (err) {
        console.error("[transactions] payment update error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );
}

// The GET list, POST add, and DELETE remove routes. Kept separate so they
// register in the same later position they held in routes.ts (after the
// visibility route).
export function registerPaymentRoutes(router: Router, ctx: PaymentRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;
  const data = makeDataSurface(pool);

  // ── Payments (settlement legs) ────────────────────────────────────────────
  router.get(
    "/:id/payments",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const payments = await data.find(
          "transaction_payments",
          ["id", "financial_account_id", "amount", "notes", "created_at", "customer_group_id"],
          {
            where: "transaction_id = $1",
            params: [req.params.id],
            orderBy: "created_at ASC, id ASC",
          },
        ) as Array<{ financial_account_id: number | null; financial_account_name?: string | null }>;
        const accountIds = [
          ...new Set(payments.map((p: { financial_account_id: number | null }) => p.financial_account_id).filter((v: number | null): v is number => v != null)),
        ];
        if (accountIds.length > 0) {
          const idh = (c.req.raw.headers.get("x-kserp-identity") ?? undefined);
          const accounts = await findAccountsByIds(accountIds, idh);
          const acctById = new Map((accounts ?? []).map((a) => [a.id, a]));
          for (const p of payments) {
            const acct = p.financial_account_id != null ? acctById.get(p.financial_account_id) : undefined;
            p.financial_account_name = acct?.name ?? null;
          }
        }
        res.json({ payments });
      } catch (err) {
        console.error("[transactions] payments list error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.post(
    "/:id/payments",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const { financial_account_id, amount, notes } = req.body ?? {};
      const parsed = parseFloat(amount);
      if (typeof financial_account_id !== "number" || !Number.isFinite(financial_account_id)) {
        res.status(400).json({ error: "financial_account_id must be a number" });
        return;
      }
      // eslint-disable-next-line sonarjs/no-inverted-boolean-check -- !(x>0) also rejects NaN (non-numeric amount); `<=0` would let NaN through, changing validation.
      if (!(parsed > 0)) {
        res.status(400).json({ error: "amount must be greater than 0" });
        return;
      }
      try {
        const tx = await data.findOne("transactions", ["id"], {
          where: "id = $1",
          params: [req.params.id],
        });
        if (!tx) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        // workspace_id is injected from the ambient tenant context by the
        // surface — never passed by the handler.
        const payment = (await data.insert(
          "transaction_payments",
          {
            transaction_id: req.params.id,
            financial_account_id,
            amount: parsed,
            notes: notes?.trim() || null,
          },
          PAYMENT_COLS,
        )) as Record<string, unknown> & { financial_account_id: number | null };
        if (payment.financial_account_id != null) {
          const idh = (c.req.raw.headers.get("x-kserp-identity") ?? undefined);
          const accounts = await findAccountsByIds([payment.financial_account_id], idh);
          payment.financial_account_name = accounts?.[0]?.name ?? null;
        }
        res.status(201).json(payment);
      } catch (err) {
        console.error("[transactions] payment create error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.delete(
    "/:id/payments/:paymentId",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      try {
        const n = await data.delete("transaction_payments", {
          where: "id = $1 AND transaction_id = $2",
          params: [req.params.paymentId, req.params.id],
        });
        if (n === 0) {
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
}
