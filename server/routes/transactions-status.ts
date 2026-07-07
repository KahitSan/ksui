// Status + share-grant write/read cluster — five smaller cohesive handlers
// grouped because each is too small to warrant its own file and they share the
// void/status + share-grant theme.
//
// registerTransactionStatusRoutes mounts, IN THIS EXACT ORDER to preserve
// Express matching: DELETE /:id (soft-delete → status='voided'),
// POST /:id/void, POST /:id/unvoid, POST /:id/forfeit (write off the
// remaining balance), PUT /:id/visibility (replace per-user/
// per-role share grants), GET /:id/line-items, and
// POST /:id/line-items/:lineItemId/void.
//
// Extracted from transactions-core.ts. Workspace scoping is preserved: routes
// migrated onto makeDataSurface inject `AND workspace_id` from the ambient tenant
// context; routes still on raw db.query keep their explicit `AND workspace_id = $N`
// (incl. the both-sides tenant delete in visibility), and all
// BEGIN/COMMIT/ROLLBACK are unchanged. registerCoreRoutes
// calls this last (after Edit), reproducing the original tail order.

import { Hono } from "hono";
import { tenant, readIdentity, applyTenantContext, makeDataSurface } from "@kahitsan/plugin-sdk";
import type { CoreRouteCtx } from "./transactions-core.js";
import { ctxGet } from "../types.js";

// Explicit column list for a line-item row — the data surface bans `RETURNING *`;
// these are every column of accounts.transaction_line_items, so the void
// response stays byte-identical to the prior `RETURNING *`.
const LINE_ITEM_COLS = [
  "id",
  "transaction_id",
  "workspace_id",
  "package_id",
  "package_variant_id",
  "description",
  "quantity",
  "unit_price",
  "duration_value",
  "duration_unit",
  "started_at",
  "ends_at",
  "status",
  "created_at",
  "updated_at",
  "client_id",
  "customer_group_id",
] as const;

export function registerTransactionStatusRoutes(router: Hono, ctx: CoreRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;
  const data = makeDataSurface(pool);

  // ── Soft-delete (void) ───────────────────────────────────────────────────
  router.delete(
    "/:id",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.delete"),
    async (c) => {
      try {
        // No BEFORE UPDATE trigger on accounts.transactions, so updated_at is
        // set explicitly — `new Date()` (an absolute instant) is TZ-safe, vs
        // `NOW()` which the surface's bound-param SET can't express.
        const rows = await data.update(
          "transactions",
          { status: "voided", updated_at: new Date(), updated_by: ctxGet(c, "user")?.id ?? null },
          { where: "id = $1 AND status != 'voided'", params: [c.req.param("id")] },
          ["id"],
        );
        if (rows.length === 0) {
          return c.json({ error: "Not found or already voided" }, 404);
        }
        return c.body(null, 204);
      } catch (err) {
        console.error("[transactions] delete error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  // ── Void / unvoid with audit ─────────────────────────────────────────────
  router.post(
    "/:id/void",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.delete"),
    async (c) => {
      const { reason } = await c.req.json() ?? {};
      if (!reason || !String(reason).trim()) {
        return c.json({ error: "reason is required" }, 400);
      }
      let dbClient: import("pg").PoolClient | null = null;
      try {
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        const result = await dbClient.query(
          `UPDATE accounts.transactions SET status = 'voided', updated_at = NOW(), updated_by = $3
             WHERE id = $1 AND workspace_id = $2 AND status != 'voided' RETURNING *`,
          [c.req.param("id"), ctxGet(c, "workspaceId"), ctxGet(c, "user")?.id ?? null],
        );
        if (result.rows.length === 0) {
          await dbClient.query("ROLLBACK");
          return c.json({ error: "Not found or already voided" }, 404);
        }
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, workspace_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'void')`,
          [c.req.param("id"), ctxGet(c, "workspaceId"), ctxGet(c, "user")?.id ?? "", String(reason).trim()],
        );
        await dbClient.query("COMMIT");
        return c.json(result.rows[0]);
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] void error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  router.post(
    "/:id/unvoid",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.delete"),
    async (c) => {
      const { reason } = await c.req.json() ?? {};
      if (!reason || !String(reason).trim()) {
        return c.json({ error: "reason is required" }, 400);
      }
      let dbClient: import("pg").PoolClient | null = null;
      try {
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        const result = await dbClient.query(
          `UPDATE accounts.transactions SET status = 'completed', updated_at = NOW(), updated_by = $3
             WHERE id = $1 AND workspace_id = $2 AND status = 'voided' RETURNING *`,
          [c.req.param("id"), ctxGet(c, "workspaceId"), ctxGet(c, "user")?.id ?? null],
        );
        if (result.rows.length === 0) {
          await dbClient.query("ROLLBACK");
          return c.json({ error: "Not found or not voided" }, 404);
        }
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, workspace_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'unvoid')`,
          [c.req.param("id"), ctxGet(c, "workspaceId"), ctxGet(c, "user")?.id ?? "", String(reason).trim()],
        );
        await dbClient.query("COMMIT");
        return c.json(result.rows[0]);
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] unvoid error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  // ── Forfeit (write off the remaining balance) ────────────────────────────
  router.post(
    "/:id/forfeit",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.delete"),
    async (c) => {
      const { reason } = await c.req.json() ?? {};
      if (!reason || !String(reason).trim()) {
        return c.json({ error: "reason is required" }, 400);
      }
      let dbClient: import("pg").PoolClient | null = null;
      try {
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        const txnId = c.req.param("id");
        const workspaceId = ctxGet(c, "workspaceId");
        // Lock the row + resolve the live balance inside the transaction so a
        // concurrent payment can't race the forfeit into writing off more
        // than is actually still owed.
        const current = await dbClient.query<{
          amount: string;
          tax_type: string;
          status: string;
          forfeited_at: Date | null;
          paid: string;
        }>(
          `SELECT t.amount, t.tax_type, t.status, t.forfeited_at,
                  COALESCE((SELECT SUM(tp.amount) FROM accounts.transaction_payments tp
                             WHERE tp.transaction_id = t.id), 0)::numeric(12,2) AS paid
             FROM accounts.transactions t
            WHERE t.id = $1 AND t.workspace_id = $2
            FOR UPDATE`,
          [txnId, workspaceId],
        );
        if (current.rows.length === 0) {
          await dbClient.query("ROLLBACK");
          return c.json({ error: "Not found" }, 404);
        }
        const row = current.rows[0];
        if (row.status === "voided") {
          await dbClient.query("ROLLBACK");
          return c.json({ error: "Cannot forfeit a voided transaction" }, 400);
        }
        if (row.forfeited_at) {
          await dbClient.query("ROLLBACK");
          return c.json({ error: "Already forfeited" }, 409);
        }
        const paid = Number(row.paid);
        const balance = Number(row.amount) - paid;
        if (balance <= 0) {
          await dbClient.query("ROLLBACK");
          return c.json({ error: "No balance to forfeit" }, 400);
        }
        // Write the headline amount down to what was actually collected —
        // the forfeited portion was never earned, so leaving `amount` at the
        // original sale price would overstate revenue on the transactions
        // list / analytics even though the balance no longer shows as due.
        // subtotal/tax_amount are recomputed from the new amount using the
        // same vat_inclusive/vat_exclusive formula the edit route uses, so
        // the VAT breakdown stays internally consistent.
        let subtotal: number;
        let taxAmount: number;
        if (row.tax_type === "vat_inclusive") {
          subtotal = Math.round((paid / 1.12) * 100) / 100;
          taxAmount = Math.round((paid - subtotal) * 100) / 100;
        } else if (row.tax_type === "vat_exclusive") {
          subtotal = paid;
          taxAmount = Math.round(paid * 0.12 * 100) / 100;
        } else {
          subtotal = paid;
          taxAmount = 0;
        }
        const result = await dbClient.query<{
          id: number;
          amount: string;
          forfeited_at: Date;
          forfeited_amount: string;
          forfeited_by: string;
          forfeited_reason: string;
          updated_at: Date;
        }>(
          `UPDATE accounts.transactions
              SET amount = $3, subtotal = $4, tax_amount = $5,
                  forfeited_at = NOW(), forfeited_amount = $6, forfeited_by = $7,
                  forfeited_reason = $8, updated_at = NOW()
            WHERE id = $1 AND workspace_id = $2
            RETURNING id, amount, forfeited_at, forfeited_amount, forfeited_by, forfeited_reason, updated_at`,
          [txnId, workspaceId, paid, subtotal, taxAmount, balance, ctxGet(c, "user")?.id ?? "", String(reason).trim()],
        );
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, workspace_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'forfeit')`,
          [txnId, workspaceId, ctxGet(c, "user")?.id ?? "", String(reason).trim()],
        );
        // Forfeiting means the customer is gone for good — settle every
        // still-active/expired line on the receipt (mirrors the Settle
        // route's as_is default) so the board moves it to Done instead of
        // leaving a live countdown running for a session nobody is coming
        // back to, which would otherwise let staff re-trigger forfeit and
        // hit the already-forfeited guard with no visible board change.
        await dbClient.query(
          `UPDATE accounts.transaction_line_items
              SET status = 'completed', ends_at = NOW(), updated_at = NOW()
            WHERE transaction_id = $1 AND workspace_id = $2 AND status IN ('active', 'expired')`,
          [txnId, workspaceId],
        );
        await dbClient.query("COMMIT");
        return c.json(result.rows[0]);
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] forfeit error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  // ── Visibility grants ─────────────────────────────────────────────────────
  router.put(
    "/:id/visibility",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      const { is_private, shared_with, shared_with_roles } = await c.req.json() ?? {};
      let dbClient: import("pg").PoolClient | null = null;
      try {
        const exists = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
          [c.req.param("id"), ctxGet(c, "workspaceId")],
        );
        if (exists.rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        const identity = readIdentity(c);
        if (!identity) {
          return c.json({ error: "Not authenticated" }, 401);
        }
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        await dbClient.query(
          `UPDATE accounts.transactions SET is_private = $3, updated_at = NOW() WHERE id = $1 AND workspace_id = $2`,
          [c.req.param("id"), ctxGet(c, "workspaceId"), Boolean(is_private)],
        );
        // Child tables have no workspace_id column; route both deletes
        // through the workspace-scoped tenant handle (same pinned client, inside the
        // BEGIN/COMMIT) so it compiles a both-sides subquery against the FK
        // parent accounts.transactions and the delete can't cross tenants.
        await tenant(dbClient, identity).delete("transaction_visibility", {
          where: "transaction_id = $1",
          params: [c.req.param("id")],
        });
        await tenant(dbClient, identity).delete("transaction_visibility_role", {
          where: "transaction_id = $1",
          params: [c.req.param("id")],
        });
        if (is_private && Array.isArray(shared_with) && shared_with.length > 0) {
          const values = shared_with.map((_: string, i: number) => `($1, $${i + 2})`).join(", ");
          await dbClient.query(
            `INSERT INTO accounts.transaction_visibility (transaction_id, user_id) VALUES ${values}
               ON CONFLICT (transaction_id, user_id) DO NOTHING`,
            [c.req.param("id"), ...shared_with],
          );
        }
        if (is_private && Array.isArray(shared_with_roles) && shared_with_roles.length > 0) {
          const values = shared_with_roles.map((_: string, i: number) => `($1, $${i + 2})`).join(", ");
          await dbClient.query(
            `INSERT INTO accounts.transaction_visibility_role (transaction_id, role_code) VALUES ${values}
               ON CONFLICT (transaction_id, role_code) DO NOTHING`,
            [c.req.param("id"), ...shared_with_roles],
          );
        }
        await dbClient.query("COMMIT");
        return c.json({ ok: true });
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] visibility error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  // ── Line items (formerly /api/transaction-line-items) ────────────────────
  router.get(
    "/:id/line-items",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c) => {
      try {
        const line_items = await data.find(
          "transaction_line_items",
          [
            "id",
            "package_id",
            "package_variant_id",
            "description",
            "quantity",
            "unit_price",
            "duration_value",
            "duration_unit",
            "started_at",
            "ends_at",
            "status",
            "client_id",
            "customer_group_id",
          ],
          { where: "transaction_id = $1", params: [c.req.param("id")], orderBy: "id ASC" },
        );
        return c.json({ line_items });
      } catch (err) {
        console.error("[transactions] line-items list error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  router.post(
    "/:id/line-items/:lineItemId/void",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      try {
        // No BEFORE UPDATE trigger, so updated_at is set explicitly (TZ-safe
        // absolute instant). RETURNING * → the full explicit column list so the
        // response shape is unchanged.
        const rows = await data.update(
          "transaction_line_items",
          { status: "voided", updated_at: new Date() },
          {
            where: "id = $1 AND transaction_id = $2 AND status != 'voided'",
            params: [c.req.param("lineItemId"), c.req.param("id")],
          },
          LINE_ITEM_COLS,
        );
        if (rows.length === 0) {
          return c.json({ error: "Not found or already voided" }, 404);
        }
        return c.json(rows[0]);
      } catch (err) {
        console.error("[transactions] line-item void error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );
}
