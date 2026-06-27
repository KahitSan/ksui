// Payment (settlement-leg) routes for the transactions router.
//
// The four payment handlers — PUT /:id/payments/:paymentId (edit a leg),
// GET /:id/payments (list legs), POST /:id/payments (add a leg), and
// DELETE /:id/payments/:paymentId (remove a leg). Extracted verbatim from
// routes.ts so the per-resource route modules share one source of truth.
//
// The PUT edit route was historically registered ahead of the analytics/charge
// reads, while the GET/POST/DELETE trio sat after the visibility route. To
// preserve the exact Hono match order, the edit route is registered via
// registerPaymentUpdateRoute (early slot) and the remaining three via
// registerPaymentRoutes (later slot). Workspace scoping is preserved either way:
// the routes migrated onto makeDataSurface inject `AND workspace_id` from the
// ambient tenant context, and the routes still on raw db.query / escapeHatch keep
// their explicit `AND workspace_id = $N` filter.

import { type Hono, type Context as HonoContext, type MiddlewareHandler } from "hono";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { makeDataSurface } from "@kahitsan/plugin-sdk";
import { findAccountsByIds } from "../lib/peers.js";

export type PaymentRouteCtx = {
  pool: PluginDb;
  requireAuth: MiddlewareHandler;
  requireWorkspace: MiddlewareHandler;
  requirePermission: (...codes: string[]) => MiddlewareHandler;
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
export function registerPaymentUpdateRoute(app: Hono, ctx: PaymentRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;
  const data = makeDataSurface(pool);

  app.put(
    "/:id/payments/:paymentId",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c: HonoContext) => {
      const { financial_account_id, amount } = await c.req.json().catch(() => ({})) as { financial_account_id?: unknown; amount?: unknown };
      const parsed = parseFloat(String(amount));
      if (typeof financial_account_id !== "number" || !Number.isFinite(financial_account_id)) {
        return c.json({ error: "financial_account_id must be a number" }, 400);
      }
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return c.json({ error: "amount must be a finite number greater than 0" }, 400);
      }
      try {
        // The surface injects `AND workspace_id = <ctx>`; the route's id +
        // transaction_id scoping stays in the user WHERE. Returns [] (→ 404)
        // when no row matches in this workspace.
        const rows = await data.update(
          "transaction_payments",
          { financial_account_id, amount: parsed },
          { where: "id = $1 AND transaction_id = $2", params: [c.req.param("paymentId"), c.req.param("id")] },
          PAYMENT_COLS,
        );
        if (rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        const payment = rows[0] as Record<string, unknown> & { financial_account_id: number | null };
        if (payment.financial_account_id != null) {
          const idh = (c.req.raw.headers.get("x-kserp-identity") ?? undefined);
          const accounts = await findAccountsByIds([payment.financial_account_id], idh);
          payment.financial_account_name = accounts?.[0]?.name ?? null;
        }
        return c.json(payment);
      } catch (err) {
        console.error("[transactions] payment update error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );
}

// The GET list, POST add, and DELETE remove routes. Kept separate so they
// register in the same later position they held in routes.ts (after the
// visibility route).
export function registerPaymentRoutes(app: Hono, ctx: PaymentRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;
  const data = makeDataSurface(pool);

  // ── Payments (settlement legs) ────────────────────────────────────────────
  app.get(
    "/:id/payments",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c: HonoContext) => {
      try {
        const payments = await data.find(
          "transaction_payments",
          ["id", "financial_account_id", "amount", "notes", "created_at", "customer_group_id"],
          {
            where: "transaction_id = $1",
            params: [c.req.param("id")],
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
        return c.json({ payments });
      } catch (err) {
        console.error("[transactions] payments list error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  app.post(
    "/:id/payments",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c: HonoContext) => {
      const { financial_account_id, amount, notes } = await c.req.json().catch(() => ({})) as { financial_account_id?: unknown; amount?: unknown; notes?: unknown };
      const parsed = parseFloat(String(amount));
      if (typeof financial_account_id !== "number" || !Number.isFinite(financial_account_id)) {
        return c.json({ error: "financial_account_id must be a number" }, 400);
      }
      // eslint-disable-next-line sonarjs/no-inverted-boolean-check -- !(x>0) also rejects NaN (non-numeric amount); `<=0` would let NaN through, changing validation.
      if (!(parsed > 0)) {
        return c.json({ error: "amount must be greater than 0" }, 400);
      }
      try {
        const tx = await data.findOne("transactions", ["id"], {
          where: "id = $1",
          params: [c.req.param("id")],
        });
        if (!tx) {
          return c.json({ error: "Not found" }, 404);
        }
        // workspace_id is injected from the ambient tenant context by the
        // surface — never passed by the handler.
        const payment = (await data.insert(
          "transaction_payments",
          {
            transaction_id: c.req.param("id"),
            financial_account_id,
            amount: parsed,
            notes: typeof notes === "string" ? notes.trim() || null : null,
          },
          PAYMENT_COLS,
        )) as Record<string, unknown> & { financial_account_id: number | null };
        if (payment.financial_account_id != null) {
          const idh = (c.req.raw.headers.get("x-kserp-identity") ?? undefined);
          const accounts = await findAccountsByIds([payment.financial_account_id], idh);
          payment.financial_account_name = accounts?.[0]?.name ?? null;
        }
        return c.json(payment, 201);
      } catch (err) {
        console.error("[transactions] payment create error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  app.delete(
    "/:id/payments/:paymentId",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c: HonoContext) => {
      try {
        const n = await data.delete("transaction_payments", {
          where: "id = $1 AND transaction_id = $2",
          params: [c.req.param("paymentId"), c.req.param("id")],
        });
        if (n === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        return c.body(null, 204);
      } catch (err) {
        console.error("[transactions] payment delete error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );
}
