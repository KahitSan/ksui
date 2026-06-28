// Subcategory taxonomy routes (formerly /api/transaction-subcategories).
//
// The four CRUD handlers for transaction_subcategories — list (by applies_to),
// create (upsert), edit, soft-delete. Extracted verbatim from routes.ts so the
// per-resource route modules can share one source of truth. registerSubcategoryRoutes
// mounts them onto the passed router under the same paths and middleware chain;
// the call site in buildRouter registers them in the same position as before.

import { type Router, type Request, type Response, type RequestHandler } from "express";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { listSubcategories, type AppliesTo } from "../lib/transaction-subcategories.js";

export type SubcategoryRouteCtx = {
  pool: PluginDb;
  requireAuth: RequestHandler;
  requireWorkspace: RequestHandler;
  requirePermission: (...codes: string[]) => RequestHandler;
};

export function registerSubcategoryRoutes(router: Router, ctx: SubcategoryRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  // ── Subcategory taxonomy (formerly /api/transaction-subcategories) ───────

  router.get(
    "/subcategories",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      const appliesTo = req.query.applies_to as string | undefined;
      if (appliesTo !== "income" && appliesTo !== "expense") {
        res.status(400).json({ error: "applies_to must be 'income' or 'expense'" });
        return;
      }
      try {
        const rows = await listSubcategories(pool, appliesTo as AppliesTo);
        res.json({ subcategories: rows });
      } catch (err) {
        console.error("[transactions] subcategories list error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.post(
    "/subcategories",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const { name, applies_to, sort_order } = req.body ?? {};
      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      if (applies_to !== "income" && applies_to !== "expense") {
        res.status(400).json({ error: "applies_to must be 'income' or 'expense'" });
        return;
      }
      try {
        const result = await pool.query(
          `INSERT INTO transaction_subcategories (name, applies_to, sort_order)
             VALUES ($1, $2, $3)
             ON CONFLICT (lower(name), applies_to) DO UPDATE SET is_active = TRUE, updated_at = NOW()
             RETURNING *`,
          [name.trim(), applies_to, Number.isFinite(sort_order) ? sort_order : 0],
        );
        res.status(201).json(result.rows[0]);
      } catch (err) {
        console.error("[transactions] subcategory create error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.put(
    "/subcategories/:id",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      const { name, sort_order, is_active } = req.body ?? {};
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (name !== undefined) {
        if (typeof name !== "string" || !name.trim()) {
          res.status(400).json({ error: "name cannot be empty" });
          return;
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
        res.status(400).json({ error: "No fields to update" });
        return;
      }
      sets.push("updated_at = NOW()");
      params.push(parseInt(String(req.params.id), 10));
      try {
        const result = await pool.query(
          `UPDATE transaction_subcategories SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
          params,
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        res.json(result.rows[0]);
      } catch (err) {
        console.error("[transactions] subcategory update error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.delete(
    "/subcategories/:id",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      try {
        const result = await pool.query(
          `UPDATE transaction_subcategories SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`,
          [parseInt(String(req.params.id), 10)],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        res.status(204).send();
      } catch (err) {
        console.error("[transactions] subcategory delete error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );
}
