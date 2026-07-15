// POST /api/transaction-line-items/:id/charge-overage and .../extend.
//
// Split out of routes-line-items.ts (Lens 14 file-size budget): both actions
// append a new line to an existing rental and re-price the parent transaction
// by the same shared helper (lib/reprice-parent-transaction.ts), so they
// belong together as one cohesive unit distinct from the list/settle routes.

import { Hono } from "hono";
import { applyTenantContext, identityHeaderOf } from "@kahitsan/plugin-sdk";
import { findVariantsByIds } from "../lib/peers.js";
import type { RouterDeps } from "../routes.js";
import { ctxGet } from "../types.js";
import {
  lockParentForReprice,
  repriceParentTransaction,
} from "../lib/reprice-parent-transaction.js";
import { LINE_ITEM_COLS } from "./shared.js";

export function registerLineItemExtendRoutes(router: Hono, deps: RouterDeps): void {
  const { db: pool, requireAuth, requireWorkspace, requirePermission } = deps;

  // ── POST /api/transaction-line-items/:id/charge-overage ──────────────────
  //
  // Charges the customer for time past a rental's booked end. Appends a new
  // 'completed' line covering the past overage window and bumps the parent
  // transaction (and the cg subtotal) by its cost. The source line stays
  // 'active'; the caller settles it separately.
  // Body: { package_variant_id: number, quantity: number }
  router.post(
    "/api/transaction-line-items/:id/charge-overage",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      if (!ctxGet(c, "workspaceId") || !ctxGet(c, "user")?.id) {
        return c.json({ error: "No workspace context" }, 403);
      }
      const id = parseInt(c.req.param("id") as string);
      if (!id) {
        return c.json({ error: "id is required" }, 400);
      }
      const { package_variant_id, quantity } = await c.req.json() as {
        package_variant_id?: number;
        quantity?: number;
      };
      if (typeof package_variant_id !== "number" || package_variant_id <= 0) {
        return c.json({ error: "package_variant_id is required" }, 400);
      }
      if (typeof quantity !== "number" || quantity <= 0) {
        return c.json({ error: "quantity must be > 0" }, 400);
      }

      const idh = identityHeaderOf(c);
      let client: import("pg").PoolClient | null = null;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await applyTenantContext(client);

        const srcRes = await client.query(
          `SELECT id, transaction_id, ends_at, client_id, status, customer_group_id
             FROM accounts.transaction_line_items
            WHERE id = $1 AND workspace_id = $2
            FOR UPDATE`,
          [id, ctxGet(c, "workspaceId")],
        );
        if (srcRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return c.json({ error: "Line item not found in this workspace" }, 404);
        }
        const src = srcRes.rows[0] as {
          id: number;
          transaction_id: number;
          ends_at: Date | null;
          client_id: number | null;
          status: string;
          customer_group_id: number | null;
        };
        if (src.status !== "active" && src.status !== "expired") {
          await client.query("ROLLBACK");
          return c.json({ error: "Line item is not active or expired" }, 409);
        }
        if (src.ends_at == null || new Date(src.ends_at).getTime() > Date.now()) {
          await client.query("ROLLBACK");
          return c.json({ error: "charge-overage is only valid for overdue line items" }, 409);
        }

        // Parent transaction's voucher/subtotal must be re-priced against the
        // NEW subtotal after the overage charge — locked FOR UPDATE alongside
        // the source line so a concurrent charge-overage can't race the
        // discount math.
        const locked = await lockParentForReprice(
          client,
          ctxGet(c, "workspaceId"),
          src.transaction_id,
          src.customer_group_id,
        );
        if (locked == null) {
          await client.query("ROLLBACK");
          return c.json({ error: "Parent transaction not found in this workspace" }, 404);
        }

        const variants = await findVariantsByIds([package_variant_id], idh);
        const variant = variants?.[0];
        if (variant == null) {
          await client.query("ROLLBACK");
          return c.json({ error: "package_variant_id must belong to this workspace" }, 400);
        }
        if (variant.duration_value == null) {
          await client.query("ROLLBACK");
          return c.json({ error: "package_variant has no duration_value" }, 400);
        }

        const durationValue = parseFloat(String(variant.duration_value));
        const unitPrice = parseFloat(String(variant.price ?? 0));
        const totalUnits = durationValue * quantity;
        const extensionCost = unitPrice * quantity;

        const intervalExpr =
          variant.duration_unit === "hour"
            ? "make_interval(hours => $7)"
            : variant.duration_unit === "day"
              ? "make_interval(days => $7)"
              : "make_interval(months => $7)";

        const insertResult = await client.query(
          `INSERT INTO accounts.transaction_line_items
             (transaction_id, workspace_id, package_id, package_variant_id,
              description, quantity, unit_price, duration_value, duration_unit,
              started_at, ends_at, status, client_id, customer_group_id)
           VALUES ($1, $2, $3, $4,
                   $5, $6, $9, $10, $11,
                   $8::timestamptz, $8::timestamptz + ${intervalExpr},
                   'completed', $12, $13)
           RETURNING ${LINE_ITEM_COLS.join(", ")}`,
          [
            src.transaction_id,
            ctxGet(c, "workspaceId"),
            variant.package_id,
            package_variant_id,
            variant.name,
            quantity,
            totalUnits,
            src.ends_at,
            unitPrice,
            durationValue,
            variant.duration_unit,
            src.client_id,
            src.customer_group_id,
          ],
        );

        // Re-apply the attached voucher (group-level takes precedence when a
        // customer group is set, matching how run-charge.ts prices it) against
        // the NEW subtotal, instead of blindly adding the raw overage cost —
        // otherwise a voucher-discounted booking silently loses its discount
        // on every overage charge.
        await repriceParentTransaction(
          client,
          idh,
          ctxGet(c, "workspaceId"),
          ctxGet(c, "user").id,
          src.transaction_id,
          extensionCost,
          locked,
        );

        await client.query("COMMIT");
        return c.json({
          source: src,
          overage_line: insertResult.rows[0],
        });
      } catch (err) {
        if (client) {
          await client.query("ROLLBACK").catch(() => {});
        }
        console.error("[transaction-line-items] charge-overage error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (client) client.release();
      }
    },
  );

  // ── POST /api/transaction-line-items/:id/extend ──────────────────────────
  //
  // Appends a new 'active' line to the same parent transaction extending the
  // rental by quantity units of the picked variant. started_at always chains
  // off the source's ends_at so the counter UI can link the lines into a
  // single entry. Bumps the parent transaction (and cg subtotal), re-running
  // the attached voucher's discount against the new subtotal so an extension
  // stays priced consistently with the original charge.
  // Body: { package_variant_id: number, quantity: number }
  router.post(
    "/api/transaction-line-items/:id/extend",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      if (!ctxGet(c, "workspaceId") || !ctxGet(c, "user")?.id) {
        return c.json({ error: "No workspace context" }, 403);
      }
      const id = parseInt(c.req.param("id") as string);
      if (!id) {
        return c.json({ error: "id is required" }, 400);
      }
      const { package_variant_id, quantity } = await c.req.json() as {
        package_variant_id?: number;
        quantity?: number;
      };
      if (typeof package_variant_id !== "number" || package_variant_id <= 0) {
        return c.json({ error: "package_variant_id is required" }, 400);
      }
      if (typeof quantity !== "number" || quantity <= 0) {
        return c.json({ error: "quantity must be > 0" }, 400);
      }

      const idh = identityHeaderOf(c);
      let client: import("pg").PoolClient | null = null;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await applyTenantContext(client);

        const srcRes = await client.query(
          `SELECT id, transaction_id, package_id, ends_at, client_id, customer_group_id
             FROM accounts.transaction_line_items
            WHERE id = $1 AND workspace_id = $2
            FOR UPDATE`,
          [id, ctxGet(c, "workspaceId")],
        );
        if (srcRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return c.json({ error: "Line item not found in this workspace" }, 404);
        }
        const src = srcRes.rows[0] as {
          id: number;
          transaction_id: number;
          package_id: number;
          ends_at: Date | null;
          client_id: number | null;
          customer_group_id: number | null;
        };

        // Parent transaction's voucher/subtotal must be re-priced against the
        // NEW subtotal after the extension — locked FOR UPDATE alongside the
        // source line so a concurrent extend can't race the discount math.
        const locked = await lockParentForReprice(
          client,
          ctxGet(c, "workspaceId"),
          src.transaction_id,
          src.customer_group_id,
        );
        if (locked == null) {
          await client.query("ROLLBACK");
          return c.json({ error: "Parent transaction not found in this workspace" }, 404);
        }

        // Variant must belong to the same workspace (resolved over RPC), but NOT
        // necessarily the source's package — cross-package extends are allowed.
        const variants = await findVariantsByIds([package_variant_id], idh);
        const variant = variants?.[0];
        if (variant == null) {
          await client.query("ROLLBACK");
          return c.json({ error: "package_variant_id must belong to this workspace" }, 400);
        }
        if (variant.duration_value == null) {
          await client.query("ROLLBACK");
          return c.json({ error: "package_variant has no duration_value" }, 400);
        }

        const durationValue = parseFloat(String(variant.duration_value));
        const unitPrice = parseFloat(String(variant.price ?? 0));
        const totalUnits = durationValue * quantity;
        const extensionCost = unitPrice * quantity;

        const intervalExpr =
          variant.duration_unit === "hour"
            ? "make_interval(hours => $7)"
            : variant.duration_unit === "day"
              ? "make_interval(days => $7)"
              : "make_interval(months => $7)";

        // Chain the extension off the source's ends_at so the counter UI can
        // link the lines into a single entry. When ends_at is null (shouldn't
        // happen for rentals) fall back to NOW().
        const startedAtExpr = "COALESCE($8::timestamptz, NOW())";

        const insertResult = await client.query(
          `INSERT INTO accounts.transaction_line_items
             (transaction_id, workspace_id, package_id, package_variant_id,
              description, quantity, unit_price, duration_value, duration_unit,
              started_at, ends_at, status, client_id, customer_group_id)
           VALUES ($1, $2, $3, $4,
                   $5, $6, $9, $10, $11,
                   ${startedAtExpr}, ${startedAtExpr} + ${intervalExpr},
                   'active', $12, $13)
           RETURNING ${LINE_ITEM_COLS.join(", ")}`,
          [
            src.transaction_id,
            ctxGet(c, "workspaceId"),
            variant.package_id,
            package_variant_id,
            variant.name,
            quantity,
            totalUnits,
            src.ends_at ?? null,
            unitPrice,
            durationValue,
            variant.duration_unit,
            src.client_id,
            src.customer_group_id,
          ],
        );

        // Re-apply the attached voucher (group-level takes precedence when a
        // customer group is set, matching how run-charge.ts prices it) against
        // the NEW subtotal, instead of blindly adding the raw extension cost —
        // otherwise a voucher-discounted booking silently loses its discount on
        // every extend.
        await repriceParentTransaction(
          client,
          idh,
          ctxGet(c, "workspaceId"),
          ctxGet(c, "user").id,
          src.transaction_id,
          extensionCost,
          locked,
        );

        await client.query("COMMIT");
        return c.json(insertResult.rows[0], 201);
      } catch (err) {
        if (client) {
          await client.query("ROLLBACK").catch(() => {});
        }
        console.error("[transaction-line-items] extend error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (client) client.release();
      }
    },
  );
}
