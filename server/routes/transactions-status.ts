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

import { type Hono, type Context as HonoContext, type MiddlewareHandler } from "hono";
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

export function registerTransactionStatusRoutes(app: Hono, ctx: CoreRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;
  const data = makeDataSurface(pool);

  // ── Soft-delete (void) ───────────────────────────────────────────────────
  app.delete(
    "/:id",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.delete"),
    async (c: HonoContext) => {
      try {
        // No BEFORE UPDATE trigger on accounts.transactions, so updated_at is
        // set explicitly — `new Date()` (an absolute instant) is TZ-safe, vs
        // `NOW()` which the surface's bound-param SET can't express.
        const rows = await data.update(
          "transactions",
          { status: "voided", updated_at: new Date(), updated_by: c.get("user")?.id ?? null },
          { where: "id = $1 AND status != 'voided'", params: [c.req.param("id")] },
          ["id"],
        );
        if (rows.length === 0) {
          return c.json({ error: "Not found or already voided" }, 404);
          return;
        }
        return c.body(null, 204);
      } catch (err) {
        console.error("[transactions] delete error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  // ── Void / unvoid with audit ─────────────────────────────────────────────
  app.post(
    "/:id/void",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.delete"),
    async (c: HonoContext) => {
      const { reason } = await c.req.json() ?? {};
      if (!reason || !String(reason).trim()) {
        return c.json({ error: "reason is required" }, 400);
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
          [c.req.param("id"), c.get("workspaceId"), c.get("user")?.id ?? null],
        );
        if (result.rows.length === 0) {
          await dbClient.query("ROLLBACK");
          return c.json({ error: "Not found or already voided" }, 404);
          return;
        }
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, workspace_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'void')`,
          [c.req.param("id"), c.get("workspaceId"), c.get("user")?.id ?? "", String(reason).trim()],
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

  app.post(
    "/:id/unvoid",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.delete"),
    async (c: HonoContext) => {
      const { reason } = await c.req.json() ?? {};
      if (!reason || !String(reason).trim()) {
        return c.json({ error: "reason is required" }, 400);
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
          [c.req.param("id"), c.get("workspaceId"), c.get("user")?.id ?? null],
        );
        if (result.rows.length === 0) {
          await dbClient.query("ROLLBACK");
          return c.json({ error: "Not found or not voided" }, 404);
          return;
        }
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, workspace_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'unvoid')`,
          [c.req.param("id"), c.get("workspaceId"), c.get("user")?.id ?? "", String(reason).trim()],
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

  // ── Visibility grants ─────────────────────────────────────────────────────
  app.put(
    "/:id/visibility",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c: HonoContext) => {
      const { is_private, shared_with, shared_with_roles } = await c.req.json() ?? {};
      let dbClient: import("pg").PoolClient | null = null;
      try {
        const exists = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
          [c.req.param("id"), c.get("workspaceId")],
        );
        if (exists.rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
          return;
        }
        const identity = readIdentity({ headers: Object.fromEntries(c.req.raw.headers.entries()) } as unknown as Parameters<typeof readIdentity>[0]);
        if (!identity) {
          return c.json({ error: "Not authenticated" }, 401);
          return;
        }
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        await dbClient.query(
          `UPDATE accounts.transactions SET is_private = $3, updated_at = NOW() WHERE id = $1 AND workspace_id = $2`,
          [c.req.param("id"), c.get("workspaceId"), Boolean(is_private)],
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
  app.get(
    "/:id/line-items",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c: HonoContext) => {
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

  app.post(
    "/:id/line-items/:lineItemId/void",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c: HonoContext) => {
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
          return;
        }
        return c.json(rows[0]);
      } catch (err) {
        console.error("[transactions] line-item void error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );
}
