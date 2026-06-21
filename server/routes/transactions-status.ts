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
// Extracted from transactions-core.ts. Workspace scoping is preserved: routes
// migrated onto makeDataSurface inject `AND workspace_id` from the ambient tenant
// context; routes still on raw db.query keep their explicit `AND workspace_id = $N`
// (incl. the both-sides tenant delete in visibility), and all
// BEGIN/COMMIT/ROLLBACK are unchanged. registerCoreRoutes
// calls this last (after Edit), reproducing the original tail order.

import { type Router, type Request, type Response } from "express";
import { tenant, readIdentity, applyTenantContext, makeDataSurface } from "@kahitsan/plugin-sdk";
import type { CoreRouteCtx } from "./transactions-core.js";

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

export function registerTransactionStatusRoutes(router: Router, ctx: CoreRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;
  const data = makeDataSurface(pool);

  // ── Soft-delete (void) ───────────────────────────────────────────────────
  router.delete(
    "/:id",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.delete"),
    async (req: Request, res: Response) => {
      try {
        // No BEFORE UPDATE trigger on accounts.transactions, so updated_at is
        // set explicitly — `new Date()` (an absolute instant) is TZ-safe, vs
        // `NOW()` which the surface's bound-param SET can't express.
        const rows = await data.update(
          "transactions",
          { status: "voided", updated_at: new Date(), updated_by: req.user?.id ?? null },
          { where: "id = $1 AND status != 'voided'", params: [req.params.id] },
          ["id"],
        );
        if (rows.length === 0) {
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
        // through the workspace-scoped tenant handle (same pinned client, inside the
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
          { where: "transaction_id = $1", params: [req.params.id], orderBy: "id ASC" },
        );
        res.json({ line_items });
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
        // No BEFORE UPDATE trigger, so updated_at is set explicitly (TZ-safe
        // absolute instant). RETURNING * → the full explicit column list so the
        // response shape is unchanged.
        const rows = await data.update(
          "transaction_line_items",
          { status: "voided", updated_at: new Date() },
          {
            where: "id = $1 AND transaction_id = $2 AND status != 'voided'",
            params: [req.params.lineItemId, req.params.id],
          },
          LINE_ITEM_COLS,
        );
        if (rows.length === 0) {
          res.status(404).json({ error: "Not found or already voided" });
          return;
        }
        res.json(rows[0]);
      } catch (err) {
        console.error("[transactions] line-item void error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );
}
