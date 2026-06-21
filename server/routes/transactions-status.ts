// Status + share-grant write/read cluster — five smaller cohesive handlers
// grouped because each is too small to warrant its own file and they share the
// void/status + share-grant theme.
//
// registerTransactionStatusRoutes mounts, IN THIS EXACT ORDER to preserve
// Express matching: DELETE /:id (soft-delete → status='voided'),
// POST /:id/void, POST /:id/unvoid, PUT /:id/visibility (replace per-user/
// per-role share grants), GET /:id/line-items, and
// POST /:id/line-items/:lineItemId/void.
//
// Extracted verbatim from transactions-core.ts. Every query keeps its
// AND workspace_id = $N org scoping, the both-sides tenant delete in
// visibility, and all BEGIN/COMMIT/ROLLBACK unchanged. registerCoreRoutes
// calls this last (after Edit), reproducing the original tail order.

import { type Router, type Request, type Response } from "express";
import { tenant, readIdentity, applyTenantContext } from "@kahitsan/plugin-sdk";
import type { CoreRouteCtx } from "./transactions-core.js";

export function registerTransactionStatusRoutes(router: Router, ctx: CoreRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  // ── Soft-delete (void) ───────────────────────────────────────────────────
  router.delete(
    "/:id",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.delete"),
    async (req: Request, res: Response) => {
      try {
        const result = await pool.query(
          `UPDATE accounts.transactions SET status = 'voided', updated_at = NOW(), updated_by = $3
             WHERE id = $1 AND workspace_id = $2 AND status != 'voided' RETURNING id`,
          [req.params.id, req.workspaceId, req.user?.id ?? null],
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
    requireWorkspace,
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
        await applyTenantContext(dbClient);
        const result = await dbClient.query(
          `UPDATE accounts.transactions SET status = 'voided', updated_at = NOW(), updated_by = $3
             WHERE id = $1 AND workspace_id = $2 AND status != 'voided' RETURNING *`,
          [req.params.id, req.workspaceId, req.user?.id ?? null],
        );
        if (result.rows.length === 0) {
          await dbClient.query("ROLLBACK");
          res.status(404).json({ error: "Not found or already voided" });
          return;
        }
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, workspace_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'void')`,
          [req.params.id, req.workspaceId, req.user?.id ?? "", String(reason).trim()],
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
    requireWorkspace,
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
        await applyTenantContext(dbClient);
        const result = await dbClient.query(
          `UPDATE accounts.transactions SET status = 'completed', updated_at = NOW(), updated_by = $3
             WHERE id = $1 AND workspace_id = $2 AND status = 'voided' RETURNING *`,
          [req.params.id, req.workspaceId, req.user?.id ?? null],
        );
        if (result.rows.length === 0) {
          await dbClient.query("ROLLBACK");
          res.status(404).json({ error: "Not found or not voided" });
          return;
        }
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, workspace_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'unvoid')`,
          [req.params.id, req.workspaceId, req.user?.id ?? "", String(reason).trim()],
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
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const { is_private, shared_with, shared_with_roles } = req.body ?? {};
      let dbClient: import("pg").PoolClient | null = null;
      try {
        const exists = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
          [req.params.id, req.workspaceId],
        );
        if (exists.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        const identity = readIdentity(req);
        if (!identity) {
          res.status(401).json({ error: "Not authenticated" });
          return;
        }
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        await dbClient.query(
          `UPDATE accounts.transactions SET is_private = $3, updated_at = NOW() WHERE id = $1 AND workspace_id = $2`,
          [req.params.id, req.workspaceId, Boolean(is_private)],
        );
        // Child tables have no workspace_id column; route both deletes
        // through the org-scoped tenant handle (same pinned client, inside the
        // BEGIN/COMMIT) so it compiles a both-sides subquery against the FK
        // parent accounts.transactions and the delete can't cross tenants.
        await tenant(dbClient, identity).delete("transaction_visibility", {
          where: "transaction_id = $1",
          params: [req.params.id],
        });
        await tenant(dbClient, identity).delete("transaction_visibility_role", {
          where: "transaction_id = $1",
          params: [req.params.id],
        });
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

  // ── Line items (formerly /api/transaction-line-items) ────────────────────
  router.get(
    "/:id/line-items",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const rows = await pool.query(
          `SELECT id, package_id, package_variant_id, description, quantity, unit_price,
                  duration_value, duration_unit, started_at, ends_at, status, client_id, customer_group_id
             FROM accounts.transaction_line_items
            WHERE transaction_id = $1 AND workspace_id = $2 ORDER BY id ASC`,
          [req.params.id, req.workspaceId],
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
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      try {
        const result = await pool.query(
          `UPDATE accounts.transaction_line_items SET status = 'voided', updated_at = NOW()
             WHERE id = $1 AND transaction_id = $2 AND workspace_id = $3 AND status != 'voided' RETURNING *`,
          [req.params.lineItemId, req.params.id, req.workspaceId],
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
}
