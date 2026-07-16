// The three counter PATCH routes — kept in a separate function so they register
// in their original position AFTER the attachment routes, preserving the exact
// Express match order. The ends_at recompute CASE (hour/day/month intervals)
// and the payer-group EXISTS sync are unchanged.
//
// Extracted verbatim from transactions-core.ts. Every query keeps its
// AND workspace_id = $N workspace scoping, the ends_at recompute CASE, the
// COALESCE(quantity, 1) math, the conditional display_name SET, and all
// BEGIN/COMMIT/ROLLBACK unchanged.

import { Hono } from "hono";
import { applyTenantContext } from "@kahitsan/plugin-sdk";
import type { CoreRouteCtx } from "./transactions-core.js";
import { ctxGet } from "../types.js";

export function registerCounterPatchRoutes(router: Hono, ctx: CoreRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  // ── Client-pool patch (counter: replace transaction_customers) ──────────
  router.patch(
    "/:id/client-pool",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      const id = parseInt(String(c.req.param("id")), 10);
      if (!Number.isFinite(id)) {
        return c.json({ error: "Invalid id" }, 400);
      }
      const { client_ids, reason } = await c.req.json() ?? {};
      if (!Array.isArray(client_ids) || client_ids.some((c: unknown) => typeof c !== "number" || !Number.isFinite(c) || c <= 0)) {
        return c.json({ error: "client_ids must be an array of positive integers" }, 400);
      }
      if (!reason || !String(reason).trim()) {
        return c.json({ error: "reason is required" }, 400);
      }
      let dbClient: import("pg").PoolClient | null = null;
      try {
        const exists = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
          [id, ctxGet(c, "workspaceId")],
        );
        if (exists.rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        await dbClient.query(
          `DELETE FROM accounts.transaction_customers WHERE transaction_id = $1 AND workspace_id = $2`,
          [id, ctxGet(c, "workspaceId")],
        );
        if (client_ids.length > 0) {
          const values: string[] = [];
          const params: unknown[] = [];
          let idx = 1;
          for (let i = 0; i < client_ids.length; i++) {
            values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
            params.push(id, client_ids[i], ctxGet(c, "workspaceId"), i);
          }
          await dbClient.query(
            `INSERT INTO accounts.transaction_customers (transaction_id, client_id, workspace_id, position)
             VALUES ${values.join(", ")}
             ON CONFLICT (transaction_id, client_id) DO UPDATE SET position = EXCLUDED.position`,
            params,
          );
        }
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, workspace_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'counter_edit')`,
          [id, ctxGet(c, "workspaceId"), ctxGet(c, "user")?.id ?? "", String(reason).trim()],
        );
        await dbClient.query("COMMIT");
        return c.json({ ok: true });
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] client-pool patch error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  // ── Customer-group started-at patch (counter: update line item times) ──
  router.patch(
    "/:id/customer-group-started-at",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      const id = parseInt(String(c.req.param("id")), 10);
      if (!Number.isFinite(id)) {
        return c.json({ error: "Invalid id" }, 400);
      }
      const { updates, reason } = await c.req.json() ?? {};
      if (!Array.isArray(updates) || updates.length === 0) {
        return c.json({ error: "updates must be a non-empty array" }, 400);
      }
      for (const u of updates) {
        // null means "every line on the receipt" — the documented contract
        // for legacy/synthetic transactions whose lines never got a
        // customer_group_id (load-edit-transaction.ts, charge-gates.ts).
        const cgOk =
          u.customer_group_id === null ||
          (typeof u.customer_group_id === "number" && Number.isFinite(u.customer_group_id) && u.customer_group_id > 0);
        if (!cgOk) {
          return c.json({ error: "each update must have a valid customer_group_id or null" }, 400);
        }
        if (typeof u.started_at !== "string" || Number.isNaN(Date.parse(u.started_at))) {
          return c.json({ error: "each update must have a valid ISO started_at" }, 400);
        }
      }
      if (!reason || !String(reason).trim()) {
        return c.json({ error: "reason is required" }, 400);
      }
      let dbClient: import("pg").PoolClient | null = null;
      try {
        const exists = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
          [id, ctxGet(c, "workspaceId")],
        );
        if (exists.rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        for (const u of updates) {
          // Moving started_at must drag ends_at with it for time-bound lines.
          // ends_at = started_at + (duration_value * quantity) of the line's unit,
          // mirroring the insert in helpers-charge.ts (and the availment_groups
          // combined-end idiom in routes-line-items.ts). Leaving ends_at stale on
          // a start-time edit inverts the window (ends_at < started_at), and the
          // natural-day CASE then buckets the already-"ended" line by its old
          // ends_at date — dropping a today session onto the wrong day board.
          // Non-duration lines (ends_at NULL) are left untouched.
          const result = await dbClient.query(
            `UPDATE accounts.transaction_line_items
                SET started_at = $1::timestamptz,
                    ends_at = CASE
                      WHEN duration_value IS NOT NULL AND duration_unit = 'hour'
                        THEN $1::timestamptz + (duration_value * COALESCE(quantity, 1)) * INTERVAL '1 hour'
                      WHEN duration_value IS NOT NULL AND duration_unit = 'day'
                        THEN $1::timestamptz + (duration_value * COALESCE(quantity, 1)) * INTERVAL '1 day'
                      WHEN duration_value IS NOT NULL AND duration_unit = 'month'
                        THEN $1::timestamptz + (duration_value * COALESCE(quantity, 1)) * INTERVAL '1 month'
                      ELSE ends_at
                    END,
                    -- completed is a staff-settled terminal state (Settle/Forfeit); a start
                    -- pushed into the future contradicts it, so reopen only that narrow case.
                    status = CASE
                      WHEN status = 'completed' AND $1::timestamptz > NOW() THEN 'active'
                      ELSE status
                    END,
                    updated_at = NOW()
              WHERE customer_group_id IS NOT DISTINCT FROM $2 AND transaction_id = $3 AND workspace_id = $4
              RETURNING id`,
            [u.started_at, u.customer_group_id, id, ctxGet(c, "workspaceId")],
          );
          // A stale/mismatched customer_group_id must not silently no-op while
          // the audit row below still records the edit as if it happened.
          if (result.rowCount === 0) {
            await dbClient.query("ROLLBACK");
            return c.json({ error: "Customer group not found" }, 404);
          }
        }
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, workspace_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'counter_edit')`,
          [id, ctxGet(c, "workspaceId"), ctxGet(c, "user")?.id ?? "", String(reason).trim()],
        );
        await dbClient.query("COMMIT");
        return c.json({ ok: true });
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] customer-group-started-at patch error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );

  // ── Customer-group client patch (counter: replace primary client) ──────
  router.patch(
    "/:id/customer-group-client",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      const id = parseInt(String(c.req.param("id")), 10);
      if (!Number.isFinite(id)) {
        return c.json({ error: "Invalid id" }, 400);
      }
      const { customer_group_id, client_id, display_name, reason } = await c.req.json() ?? {};
      if (typeof customer_group_id !== "number" || !Number.isFinite(customer_group_id) || customer_group_id <= 0) {
        return c.json({ error: "customer_group_id must be a positive integer" }, 400);
      }
      if (client_id != null && (typeof client_id !== "number" || !Number.isFinite(client_id) || client_id <= 0)) {
        return c.json({ error: "client_id must be a positive integer or null" }, 400);
      }
      if (display_name != null && typeof display_name !== "string") {
        return c.json({ error: "display_name must be a string or null" }, 400);
      }
      if (!reason || !String(reason).trim()) {
        return c.json({ error: "reason is required" }, 400);
      }
      let dbClient: import("pg").PoolClient | null = null;
      try {
        const exists = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
          [id, ctxGet(c, "workspaceId")],
        );
        if (exists.rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        const cgExists = await pool.query(
          `SELECT id FROM accounts.transaction_customer_groups WHERE id = $1 AND transaction_id = $2 AND workspace_id = $3`,
          [customer_group_id, id, ctxGet(c, "workspaceId")],
        );
        if (cgExists.rows.length === 0) {
          return c.json({ error: "Customer group not found" }, 404);
        }
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);
        // Update the customer group's own client_id. display_name is
        // accepted as an optional best-effort update from the frontend
        // (it sends the new client's name_raw), but the column is
        // only the display source for walk-ins — client-linked groups
        // resolve their name dynamically from the clients table at read
        // time, so omitting display_name here is harmless for them.
        const newDisplayName = display_name !== undefined && display_name !== null ? String(display_name) : undefined;
        await dbClient.query(
          `UPDATE accounts.transaction_customer_groups
              SET client_id = $1${newDisplayName !== undefined ? ", display_name = $5" : ""}
            WHERE id = $2 AND transaction_id = $3 AND workspace_id = $4`,
          newDisplayName !== undefined
            ? [client_id ?? null, customer_group_id, id, ctxGet(c, "workspaceId"), newDisplayName]
            : [client_id ?? null, customer_group_id, id, ctxGet(c, "workspaceId")],
        );
        await dbClient.query(
          `UPDATE accounts.transaction_line_items SET client_id = $1 WHERE customer_group_id = $2 AND transaction_id = $3 AND workspace_id = $4`,
          [client_id ?? null, customer_group_id, id, ctxGet(c, "workspaceId")],
        );
        // When the payer's customer group changes clients, sync the
        // top-level transaction.client_id so the counter listing card
        // header (which reads t.client_id, not cg.client_id) reflects
        // the new billed-to name without a page refresh. The EXISTS
        // guard means only payer-group changes trigger this.
        await dbClient.query(
          `UPDATE accounts.transactions
              SET client_id = $1
            WHERE id = $2 AND workspace_id = $3
              AND EXISTS (SELECT 1 FROM accounts.transaction_customer_groups
                           WHERE id = $4 AND is_payer = TRUE)`,
          [client_id ?? null, id, ctxGet(c, "workspaceId"), customer_group_id],
        );
        await dbClient.query(
          `INSERT INTO accounts.transaction_edits (transaction_id, workspace_id, edited_by, reason, kind)
             VALUES ($1, $2, $3, $4, 'counter_edit')`,
          [id, ctxGet(c, "workspaceId"), ctxGet(c, "user")?.id ?? "", String(reason).trim()],
        );
        await dbClient.query("COMMIT");
        return c.json({ ok: true });
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] customer-group-client patch error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );
}
