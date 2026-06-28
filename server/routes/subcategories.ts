// Subcategory taxonomy routes (formerly /api/transaction-subcategories).
//
// The four CRUD handlers for transaction_subcategories — list (by applies_to),
// create (upsert), edit, soft-delete. Extracted verbatim from routes.ts so the
// per-resource route modules can share one source of truth. registerSubcategoryRoutes
// mounts them onto the passed router under the same paths and middleware chain;
// the call site in buildRouter registers them in the same position as before.

import { Hono, type MiddlewareHandler } from "hono";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { listSubcategories, type AppliesTo } from "../lib/transaction-subcategories.js";

export type SubcategoryRouteCtx = {
  pool: PluginDb;
  requireAuth: MiddlewareHandler;
  requireWorkspace: MiddlewareHandler;
  requirePermission: (...codes: string[]) => MiddlewareHandler;
};

export function registerSubcategoryRoutes(router: Hono, ctx: SubcategoryRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  // ── Subcategory taxonomy (formerly /api/transaction-subcategories) ───────

  router.get(
    "/subcategories",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c) => {
      const appliesTo = c.req.query("applies_to") as string | undefined;
      if (appliesTo !== "income" && appliesTo !== "expense") {
        return c.json({ error: "applies_to must be 'income' or 'expense'" }, 400);
      }
      try {
        const rows = await listSubcategories(pool, appliesTo as AppliesTo);
        return c.json({ subcategories: rows });
      } catch (err) {
        console.error("[transactions] subcategories list error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  router.post(
    "/subcategories",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      const { name, applies_to, sort_order } = await c.req.json() ?? {};
      if (!name || typeof name !== "string" || !name.trim()) {
        return c.json({ error: "name is required" }, 400);
      }
      if (applies_to !== "income" && applies_to !== "expense") {
        return c.json({ error: "applies_to must be 'income' or 'expense'" }, 400);
      }
      try {
        const result = await pool.query(
          `INSERT INTO transaction_subcategories (name, applies_to, sort_order)
             VALUES ($1, $2, $3)
             ON CONFLICT (lower(name), applies_to) DO UPDATE SET is_active = TRUE, updated_at = NOW()
             RETURNING *`,
          [name.trim(), applies_to, Number.isFinite(sort_order) ? sort_order : 0],
        );
        return c.json(result.rows[0], 201);
      } catch (err) {
        console.error("[transactions] subcategory create error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  router.put(
    "/subcategories/:id",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      const { name, sort_order, is_active } = await c.req.json() ?? {};
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (name !== undefined) {
        if (typeof name !== "string" || !name.trim()) {
          return c.json({ error: "name cannot be empty" }, 400);
        }
        sets.push(`name = $${idx++}`);
        params.push(name.trim());
      }
      if (sort_order !== undefined) {
        sets.push(`sort_order = $${idx++}`);
        params.push(Number.isFinite(sort_order) ? sort_order : 0);
      }
      if (is_active !== undefined) {
        sets.push(`is_active = $${idx++}`);
        params.push(Boolean(is_active));
      }
      if (sets.length === 0) {
        return c.json({ error: "No fields to update" }, 400);
      }
      sets.push("updated_at = NOW()");
      params.push(parseInt(String(c.req.param("id")), 10));
      try {
        const result = await pool.query(
          `UPDATE transaction_subcategories SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
          params,
        );
        if (result.rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        return c.json(result.rows[0]);
      } catch (err) {
        console.error("[transactions] subcategory update error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  router.delete(
    "/subcategories/:id",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      try {
        const result = await pool.query(
          `UPDATE transaction_subcategories SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`,
          [parseInt(String(c.req.param("id")), 10)],
        );
        if (result.rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        return c.body(null, 204);
      } catch (err) {
        console.error("[transactions] subcategory delete error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );
}
