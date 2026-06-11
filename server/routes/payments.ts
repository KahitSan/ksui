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
// registerPaymentRoutes (later slot). Every query keeps its
// AND organization_id = $N org scoping unchanged.

import { type Router, type Request, type Response, type RequestHandler } from "express";
import type { PluginDb } from "@ks-erp/kernel/services/database";

export type PaymentRouteCtx = {
  pool: PluginDb;
  requireAuth: RequestHandler;
  requireOrg: RequestHandler;
  requirePermission: (...codes: string[]) => RequestHandler;
};

// The PUT edit-leg route. Kept separate so it registers in the same early
// position it held in routes.ts (ahead of the analytics/charge reads).
export function registerPaymentUpdateRoute(router: Router, ctx: PaymentRouteCtx): void {
  const { pool, requireAuth, requireOrg, requirePermission } = ctx;

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
}

// The GET list, POST add, and DELETE remove routes. Kept separate so they
// register in the same later position they held in routes.ts (after the
// visibility route).
export function registerPaymentRoutes(router: Router, ctx: PaymentRouteCtx): void {
  const { pool, requireAuth, requireOrg, requirePermission } = ctx;

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
      // eslint-disable-next-line sonarjs/no-inverted-boolean-check -- !(x>0) also rejects NaN (non-numeric amount); `<=0` would let NaN through, changing validation.
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
}
