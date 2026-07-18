// POST /api/transactions/:id/apply-cart-edit — the same-transaction edit-cart
// Save: reductions (voids/quantity-decreases) AND additions (new lines on an
// existing or brand-new customer group) apply atomically to the SAME paid
// accounts.transactions row. No child transaction is ever created here — see
// SAME-TX-EDIT-BRIEF.md. Kept out of run-charge.ts (INSERT-only by contract)
// and off makeDataSurface (needs FOR UPDATE row locks + multi-statement
// control flow), matching the line-items-extend.ts / transactions-status.ts
// /void precedent.

import { Hono } from "hono";
import { applyTenantContext, identityHeaderOf } from "@kahitsan/plugin-sdk";
import type { CoreRouteCtx } from "./transactions-core.js";
import { ctxGet } from "../types.js";
import { assertParentEditable, lockParentForReprice, repriceParentTransaction } from "../lib/reprice-parent-transaction.js";
import { insertLineItemsForTransaction, insertNewCustomerGroup } from "../charge/insert-line-items.js";
import type { ChargeLineInput, ValidUnit } from "../charge/validate.js";
import { findVariantsByIds, findPackagesByIds, type PackageVariantRow } from "../lib/peers.js";
import { deriveActiveLineSummary } from "../lib/active-line-summary.js";
import { MAX_NUMERIC_12_2 } from "./shared.js";

interface ReductionInput {
  customer_group_id: number | null;
  package_id: number;
  package_variant_id: number;
  target_quantity: number;
}

interface AdditionAnchorChain {
  chain_from_line_id: number;
}

interface AdditionAnchorStartedAt {
  started_at: string;
}

// package_id/description/unit_price/duration_value/duration_unit are NEVER
// accepted from the client (B5) — package_variant_id is the only cart ref,
// resolved server-side through the packages RPC (findVariantsByIds) exactly
// like /extend and /charge-overage, and every priced/duration field is
// derived from that resolved row before insert.
interface AdditionItem {
  package_variant_id: number;
  quantity: number;
  anchor: "now" | AdditionAnchorChain | AdditionAnchorStartedAt;
}

interface NewGroupInput {
  client_id: number | null;
  display_name: string;
  note: string | null;
  voucher_id: number | null;
  is_payer?: boolean;
  // Accepted + shape-validated for forward compat with the group-level
  // anchor the client UI already exposes, but each item's own `anchor`
  // (not the group's) governs started_at below — intentionally unused here.
  started_at: string | null;
}

interface AdditionToExistingGroup {
  customer_group_id: number;
  new_group?: undefined;
  items: AdditionItem[];
}

interface AdditionToNewGroup {
  customer_group_id: null;
  new_group: NewGroupInput;
  items: AdditionItem[];
}

type AdditionEntry = AdditionToExistingGroup | AdditionToNewGroup;

interface CartEditBody {
  edit_token?: string;
  reason?: string;
  reductions?: ReductionInput[];
  additions?: AdditionEntry[];
  reassign_payer_to?: number | null;
}

interface LockedLineRow {
  id: number;
  quantity: string;
  unit_price: string;
}

function isValidReduction(r: unknown): r is ReductionInput {
  if (r == null || typeof r !== "object") return false;
  const v = r as Record<string, unknown>;
  const cgOk = v.customer_group_id === null || typeof v.customer_group_id === "number";
  const pkgOk = typeof v.package_id === "number" && v.package_id > 0;
  const varOk = typeof v.package_variant_id === "number" && v.package_variant_id > 0;
  const qtyOk = typeof v.target_quantity === "number" && Number.isInteger(v.target_quantity) && v.target_quantity >= 0;
  return cgOk && pkgOk && varOk && qtyOk;
}

function isValidAdditionAnchor(anchor: unknown): anchor is "now" | AdditionAnchorChain | AdditionAnchorStartedAt {
  if (anchor === "now") return true;
  if (anchor == null || typeof anchor !== "object") return false;
  const a = anchor as Record<string, unknown>;
  if (typeof a.chain_from_line_id === "number") {
    return Number.isInteger(a.chain_from_line_id) && a.chain_from_line_id > 0;
  }
  if (typeof a.started_at === "string") return !Number.isNaN(Date.parse(a.started_at));
  return false;
}

// Mirrors validate.ts's isValidChargeLine numeric discipline (finite, > 0 —
// no integer requirement, since quantity here is "how many periods of the
// resolved variant," matching /extend's own quantity contract).
function isValidAdditionItem(item: unknown): item is AdditionItem {
  if (item == null || typeof item !== "object") return false;
  const v = item as Record<string, unknown>;
  const varOk = typeof v.package_variant_id === "number" && v.package_variant_id > 0;
  const qtyOk = typeof v.quantity === "number" && Number.isFinite(v.quantity) && v.quantity > 0;
  return varOk && qtyOk && isValidAdditionAnchor(v.anchor);
}

function isValidNewGroupInput(ng: unknown): ng is NewGroupInput {
  if (ng == null || typeof ng !== "object") return false;
  const v = ng as Record<string, unknown>;
  const clientOk = v.client_id === null || typeof v.client_id === "number";
  const nameOk = typeof v.display_name === "string" && v.display_name.trim().length > 0;
  const noteOk = v.note === null || typeof v.note === "string";
  const voucherOk = v.voucher_id === null || typeof v.voucher_id === "number";
  const payerOk = v.is_payer === undefined || typeof v.is_payer === "boolean";
  const startedOk = v.started_at === null || typeof v.started_at === "string";
  return clientOk && nameOk && noteOk && voucherOk && payerOk && startedOk;
}

// Exactly one of customer_group_id (existing, non-null) or customer_group_id:
// null + new_group (brand-new group) — never both, never neither.
function isValidAdditionEntry(entry: unknown): entry is AdditionEntry {
  if (entry == null || typeof entry !== "object") return false;
  const v = entry as Record<string, unknown>;
  const hasNewGroup = v.new_group !== undefined && v.new_group !== null;
  if (v.customer_group_id === null) {
    if (!hasNewGroup || !isValidNewGroupInput(v.new_group)) return false;
  } else if (typeof v.customer_group_id === "number" && v.customer_group_id > 0) {
    if (hasNewGroup) return false;
  } else {
    return false;
  }
  return Array.isArray(v.items) && v.items.length > 0 && v.items.every(isValidAdditionItem);
}

export function registerTransactionCartEditRoute(router: Hono, ctx: CoreRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  router.post(
    "/:id/apply-cart-edit",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      const id = parseInt(String(c.req.param("id")), 10);
      if (!Number.isFinite(id)) {
        return c.json({ error: "Invalid id" }, 400);
      }
      const body = (await c.req.json().catch(() => ({}))) as CartEditBody;
      const editToken = body.edit_token;
      const reason = body.reason;
      if (!editToken || !String(editToken).trim()) {
        return c.json({ error: "edit_token is required" }, 400);
      }
      if (!reason || !String(reason).trim()) {
        return c.json({ error: "reason is required" }, 400);
      }

      const reductions = Array.isArray(body.reductions) ? body.reductions : undefined;
      if (reductions !== undefined && !reductions.every(isValidReduction)) {
        return c.json({ error: "Each reduction needs package_id, package_variant_id, and an integer target_quantity >= 0" }, 400);
      }
      // An empty additions array is a no-op, not a 400 — a Save with only
      // reductions (or only pool/started-at/client PATCHes fired alongside
      // this call) is a legitimate call with additions absent or empty.
      const additionsRaw = Array.isArray(body.additions) ? body.additions : undefined;
      if (additionsRaw !== undefined && !additionsRaw.every(isValidAdditionEntry)) {
        return c.json(
          { error: "Each addition needs exactly one of customer_group_id or new_group, and a non-empty valid items array" },
          400,
        );
      }
      const reassignPayerTo = body.reassign_payer_to;
      if (
        reassignPayerTo !== undefined &&
        reassignPayerTo !== null &&
        (typeof reassignPayerTo !== "number" || !Number.isInteger(reassignPayerTo) || reassignPayerTo <= 0)
      ) {
        return c.json({ error: "reassign_payer_to must be a positive integer or null" }, 400);
      }
      const newGroupPayerCount = (additionsRaw ?? []).filter(
        (a) => a.customer_group_id === null && a.new_group.is_payer === true,
      ).length;
      if (reassignPayerTo != null && newGroupPayerCount > 0) {
        return c.json({ error: "reassign_payer_to and new_group.is_payer are mutually exclusive in one request" }, 400);
      }
      if (newGroupPayerCount > 1) {
        return c.json({ error: "At most one addition may set new_group.is_payer" }, 400);
      }

      const hasReductions = reductions !== undefined && reductions.length > 0;
      const hasAdditions = additionsRaw !== undefined && additionsRaw.length > 0;
      if (!hasReductions && !hasAdditions && reassignPayerTo == null) {
        return c.json({ error: "At least one of reductions, additions, or reassign_payer_to must be provided" }, 400);
      }

      const workspaceId = ctxGet(c, "workspaceId");
      const userId = ctxGet(c, "user")?.id;
      const idh = identityHeaderOf(c);

      // B5: every addition item's package_variant_id is resolved through the
      // packages RPC BEFORE BEGIN — mirrors run-charge.ts/extend.ts. A cart
      // that references a package_variant_id the RPC doesn't return (unknown
      // id, foreign workspace, or the packages plugin being off) 400s here,
      // before any row lock or DB write.
      const additionVariantIds = [
        ...new Set((additionsRaw ?? []).flatMap((entry) => entry.items.map((item) => item.package_variant_id))),
      ];
      const variantById = new Map<number, PackageVariantRow>();
      // PackageVariantRow carries no package name (see peers.ts), so it's
      // resolved separately here — matches the "PackageName — VariantName"
      // format build-charge-payload.ts:139 builds client-side at charge time,
      // kept server-derived here since this route never accepts a
      // client-supplied description (B5).
      const packageNameById = new Map<number, string>();
      if (additionVariantIds.length > 0) {
        const variants = await findVariantsByIds(additionVariantIds, idh);
        if (variants == null) {
          return c.json(
            {
              error:
                "This cart references packages, but the packages plugin is not available. Enable the packages plugin to add line items.",
            },
            503,
          );
        }
        for (const v of variants) variantById.set(v.id, v);

        const additionPackageIds = [...new Set(variants.map((v) => v.package_id))];
        const packages = additionPackageIds.length > 0 ? await findPackagesByIds(additionPackageIds, idh) : [];
        for (const p of packages ?? []) packageNameById.set(p.id, p.name);

        for (const vid of additionVariantIds) {
          const variant = variantById.get(vid);
          if (variant == null) {
            return c.json({ error: "package_variant_id must belong to this workspace" }, 400);
          }
          // Same 22003-avoidance as validate.ts's unit_price upper bound — a
          // variant price already stored past NUMERIC(12,2) would otherwise
          // 500 instead of cleanly 400ing here.
          if (variant.price != null && parseFloat(String(variant.price)) > MAX_NUMERIC_12_2) {
            return c.json({ error: "package_variant price exceeds the maximum allowed" }, 400);
          }
        }
      }

      let dbClient: import("pg").PoolClient | null = null;
      try {
        dbClient = await pool.connect();
        await dbClient.query("BEGIN");
        await applyTenantContext(dbClient);

        // Parent FOR UPDATE lock acquired FIRST, before the replay check —
        // two concurrent requests with the same edit_token both contend on
        // this row, so the loser blocks until the winner's transaction_edits
        // INSERT commits, then its replay lookup (below) finds that row
        // instead of racing past it into a second void.
        const locked = await lockParentForReprice(dbClient, workspaceId, id, null);
        if (locked == null) {
          await dbClient.query("ROLLBACK");
          return c.json({ error: "Transaction not found in this workspace" }, 404);
        }
        const editable = assertParentEditable(locked.parentTxn);
        if (!editable.ok) {
          await dbClient.query("ROLLBACK");
          return c.json({ error: editable.error }, 409);
        }

        // transaction_edits is INSERT/SELECT-only under RLS (append-only
        // audit trail, no UPDATE policy), so edit_id is merged in from the
        // row's own id here rather than stored inside payload by a
        // follow-up UPDATE.
        const replay = await dbClient.query<{ id: number; payload: Record<string, unknown> }>(
          `SELECT id, payload FROM accounts.transaction_edits
             WHERE transaction_id = $1 AND workspace_id = $2 AND idempotency_key = $3`,
          [id, workspaceId, String(editToken).trim()],
        );
        if (replay.rows.length > 0) {
          await dbClient.query("ROLLBACK");
          return c.json({ ...replay.rows[0].payload, edit_id: replay.rows[0].id });
        }

        // Per-customer-group signed cost delta, accumulated across every
        // reduction entry (negative) and addition entry (positive) that
        // targets that group (including the synthetic `null` legacy/single-cg
        // bucket) — both loops feed this ONE map before any reprice call
        // fires, so there is no cross-call ordering to sequence around.
        const costDeltaByGroup = new Map<number | null, number>();
        const voidedLineItemIds: number[] = [];
        const reducedLineItems: Array<{ id: number; quantity: number }> = [];
        const addedLineItemIds: number[] = [];
        const newCustomerGroupIds: number[] = [];

        for (const reduction of reductions ?? []) {
          const rowsRes = await dbClient.query<LockedLineRow>(
            `SELECT id, quantity, unit_price FROM accounts.transaction_line_items
               WHERE transaction_id = $1 AND workspace_id = $2
                 AND customer_group_id IS NOT DISTINCT FROM $3
                 AND package_id = $4 AND package_variant_id = $5
                 AND status IN ('active', 'completed', 'expired')
               ORDER BY id DESC
               FOR UPDATE`,
            [id, workspaceId, reduction.customer_group_id, reduction.package_id, reduction.package_variant_id],
          );
          if (rowsRes.rows.length === 0) {
            await dbClient.query("ROLLBACK");
            return c.json({ error: "No active line items match a requested reduction" }, 404);
          }
          const currentAggregate = rowsRes.rows.reduce((sum, r) => sum + parseFloat(r.quantity), 0);
          if (reduction.target_quantity >= currentAggregate) {
            await dbClient.query("ROLLBACK");
            return c.json({ error: "target_quantity must be less than the current active quantity" }, 400);
          }

          // LIFO: undo the most-recently-added row for this combo first, so a
          // later /extend addition on top of an original line unwinds before
          // the original line does.
          let remaining = currentAggregate - reduction.target_quantity;
          let groupDelta = costDeltaByGroup.get(reduction.customer_group_id) ?? 0;
          for (const row of rowsRes.rows) {
            if (remaining <= 0) break;
            const rowQty = parseFloat(row.quantity);
            const unitPrice = parseFloat(row.unit_price);
            if (rowQty <= remaining) {
              await dbClient.query(
                `UPDATE accounts.transaction_line_items SET status = 'voided', updated_at = NOW()
                   WHERE id = $1 AND workspace_id = $2`,
                [row.id, workspaceId],
              );
              voidedLineItemIds.push(row.id);
              groupDelta -= unitPrice * rowQty;
              remaining -= rowQty;
            } else {
              const newQty = rowQty - remaining;
              await dbClient.query(
                `UPDATE accounts.transaction_line_items SET quantity = $1, updated_at = NOW()
                   WHERE id = $2 AND workspace_id = $3`,
                [newQty, row.id, workspaceId],
              );
              reducedLineItems.push({ id: row.id, quantity: newQty });
              groupDelta -= unitPrice * remaining;
              remaining = 0;
            }
          }
          costDeltaByGroup.set(reduction.customer_group_id, groupDelta);
        }

        // Gate for the retroactive batch_code assignment below — read BEFORE
        // the additions loop mutates transaction_customer_groups, since it
        // asks "was this a 1-cg (or 0-cg) transaction before this call".
        const cgCountBeforeRes = await dbClient.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM accounts.transaction_customer_groups
             WHERE transaction_id = $1 AND workspace_id = $2`,
          [id, workspaceId],
        );
        const wasSingleOrNoGroup = parseInt(cgCountBeforeRes.rows[0].n, 10) <= 1;
        let createdNewGroup = false;
        let flaggedNewGroupId: number | null = null;

        for (const addition of additionsRaw ?? []) {
          let cgId: number;
          let groupClientId: number | null;
          if (addition.customer_group_id === null) {
            const ng = addition.new_group;
            const created = await insertNewCustomerGroup(
              dbClient,
              id,
              workspaceId,
              {
                client_id: ng.client_id,
                display_name: ng.display_name,
                note: ng.note,
                voucher_id: ng.voucher_id,
                // Always inserted FALSE here, even when ng.is_payer is true:
                // accounts.transaction_customer_groups carries a partial
                // unique index (one is_payer=TRUE row per transaction, added
                // by migrations/20260716000000_add_transaction_customer_groups_single_payer_index.ts)
                // that an existing payer group is still holding at this point
                // in the loop — inserting TRUE here would 23505 before the
                // atomic flip below ever runs. flaggedNewGroupId (below)
                // carries the intent forward; the flip-UPDATE after the
                // reprice loop is the ONLY statement that ever writes
                // is_payer=TRUE for this route, so it never races the index.
                is_payer: false,
              },
              idh,
            );
            cgId = created.id;
            groupClientId = ng.client_id;
            newCustomerGroupIds.push(cgId);
            createdNewGroup = true;
            if (ng.is_payer === true) flaggedNewGroupId = cgId;

            if (ng.client_id != null) {
              const poolPosRes = await dbClient.query<{ next_position: number }>(
                `SELECT COALESCE(MAX(position), -1) + 1 AS next_position
                   FROM accounts.transaction_customers WHERE transaction_id = $1`,
                [id],
              );
              await dbClient.query(
                `INSERT INTO accounts.transaction_customers (transaction_id, client_id, workspace_id, position)
                   VALUES ($1, $2, $3, $4)
                 ON CONFLICT (transaction_id, client_id) DO UPDATE SET position = EXCLUDED.position`,
                [id, ng.client_id, workspaceId, poolPosRes.rows[0].next_position],
              );
            }
          } else {
            cgId = addition.customer_group_id;
            const existsRes = await dbClient.query<{ client_id: number | null }>(
              `SELECT client_id FROM accounts.transaction_customer_groups
                 WHERE id = $1 AND transaction_id = $2 AND workspace_id = $3`,
              [cgId, id, workspaceId],
            );
            if (existsRes.rows.length === 0) {
              await dbClient.query("ROLLBACK");
              return c.json({ error: "customer_group_id must belong to this transaction" }, 404);
            }
            groupClientId = existsRes.rows[0].client_id;
          }

          const items: ChargeLineInput[] = [];
          const perLineStartedAt: (string | null)[] = [];
          for (const item of addition.items) {
            // Resolved pre-BEGIN (missing entries already 400'd the whole
            // call before any lock was taken) — package_id/description/
            // unit_price/duration are ALWAYS derived from the variant row,
            // never the client, matching /extend's precedent.
            const variant = variantById.get(item.package_variant_id) as PackageVariantRow;
            const pkgName = packageNameById.get(variant.package_id);
            items.push({
              package_id: variant.package_id,
              package_variant_id: item.package_variant_id,
              description: pkgName != null ? `${pkgName} — ${variant.name}` : variant.name,
              quantity: item.quantity,
              unit_price: parseFloat(String(variant.price ?? 0)),
              duration_value: variant.duration_value != null ? parseFloat(String(variant.duration_value)) : null,
              duration_unit: (variant.duration_unit as ValidUnit | null) ?? null,
            });
            if (item.anchor === "now") {
              // null forces NOW() in insertLineItemsForTransaction — a
              // brand-new package pick is a fresh charge, not an extension.
              perLineStartedAt.push(null);
              continue;
            }
            if ("started_at" in item.anchor) {
              const startedAtMs = Date.parse(item.anchor.started_at);
              // Bounds are a judgment call — no existing convention in this
              // codebase (checked validate.ts, transactions-counter-patch.ts,
              // export.ts: all Date.parse-NaN-check only, no range). An
              // anchor this far off is never a legitimate "this customer's
              // original start" — it's a client bug or a stale hydrate
              // snapshot, and should 400 rather than silently corrupt the
              // line's timing.
              const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
              const ONE_DAY_MS = 24 * 60 * 60 * 1000;
              if (startedAtMs < Date.now() - FIVE_YEARS_MS || startedAtMs > Date.now() + ONE_DAY_MS) {
                await dbClient.query("ROLLBACK");
                return c.json({ error: "anchor.started_at is out of the allowed range" }, 400);
              }
              perLineStartedAt.push(new Date(startedAtMs).toISOString());
              continue;
            }
            // Server resolves chain_from_line_id to the source's ends_at,
            // matching /extend's existing precedent (the client never
            // computes or sends an ISO) — cross-transaction chaining is
            // refused since the source must belong to THIS transaction.
            const chainRes = await dbClient.query<{ ends_at: Date | null }>(
              `SELECT ends_at FROM accounts.transaction_line_items
                 WHERE id = $1 AND transaction_id = $2 AND workspace_id = $3
                 FOR UPDATE`,
              [item.anchor.chain_from_line_id, id, workspaceId],
            );
            if (chainRes.rows.length === 0) {
              await dbClient.query("ROLLBACK");
              return c.json({ error: "chain_from_line_id must belong to this transaction" }, 404);
            }
            const srcEndsAt = chainRes.rows[0].ends_at;
            if (srcEndsAt == null) {
              await dbClient.query("ROLLBACK");
              return c.json({ error: "chain_from_line_id has no ends_at to chain from" }, 400);
            }
            perLineStartedAt.push(new Date(srcEndsAt).toISOString());
          }

          const perLineCustomerGroupIds: (number | null)[] = new Array(items.length).fill(cgId);
          const perLineClientIds: (number | null)[] = new Array(items.length).fill(groupClientId);

          const insertedLines = await insertLineItemsForTransaction(
            dbClient,
            id,
            workspaceId,
            groupClientId,
            items,
            {
              // Inert default: every line supplies an explicit
              // perLineStartedAt entry (never undefined), so the global
              // anchor field never actually fires — same pattern
              // run-charge.ts's multi-customer path already uses.
              anchor: "now",
              initialStatus: "active",
              perLineCustomerGroupIds,
              perLineClientIds,
              perLineStartedAt,
            },
          );
          for (const li of insertedLines) {
            addedLineItemIds.push(li.id as number);
          }

          // Priced off the DERIVED items[] (server-resolved unit_price), not
          // the raw client addition.items — the client no longer sends a
          // price at all.
          let groupDelta = costDeltaByGroup.get(cgId) ?? 0;
          for (const li of items) {
            groupDelta += li.quantity * li.unit_price;
          }
          costDeltaByGroup.set(cgId, groupDelta);
        }

        // Retroactive batch_code: an addition just turned a 1-cg (or 0-cg)
        // transaction into a 2+-cg one. COALESCE keeps this idempotent-safe
        // on replay and protects an already-2+-cg transaction from ever
        // getting a second nextval() call.
        if (createdNewGroup && wasSingleOrNoGroup) {
          await dbClient.query(
            `UPDATE accounts.transactions
                SET batch_code = COALESCE(batch_code, nextval('accounts.transaction_batch_code_seq'))
              WHERE id = $1 AND workspace_id = $2`,
            [id, workspaceId],
          );
        }

        for (const [customerGroupId, costDelta] of costDeltaByGroup) {
          if (costDelta === 0) continue;
          const groupLock = await lockParentForReprice(dbClient, workspaceId, id, customerGroupId);
          if (groupLock == null) {
            await dbClient.query("ROLLBACK");
            return c.json({ error: "Transaction not found in this workspace" }, 404);
          }
          await repriceParentTransaction(dbClient, idh, workspaceId, userId, id, costDelta, groupLock);
        }

        // Resolve the single desired payer target: an explicit reassignment
        // always wins; otherwise a brand-new group's own is_payer:true (set
        // during insertNewCustomerGroup above) is already persisted and
        // needs no further action here.
        const payerTarget = reassignPayerTo ?? flaggedNewGroupId;
        if (payerTarget != null) {
          // Single UPDATE flips exactly one row to is_payer=TRUE and every
          // other row on this transaction to FALSE — no separate "unset old,
          // set new" pair, so there is no window where two rows (or zero
          // rows) hold is_payer=TRUE even if this crashes mid-statement.
          // transaction_customer_groups has no updated_at column (only
          // created_at) — confirmed against migrations/20260527000000_create_transactions.ts.
          const flip = await dbClient.query<{ id: number }>(
            `UPDATE accounts.transaction_customer_groups
                SET is_payer = (id = $1)
              WHERE transaction_id = $2 AND workspace_id = $3
              RETURNING id`,
            [payerTarget, id, workspaceId],
          );
          if (!flip.rows.some((r) => r.id === payerTarget)) {
            await dbClient.query("ROLLBACK");
            return c.json({ error: "reassign_payer_to must belong to this transaction" }, 404);
          }
          // The receipt header/board-card billed-to tracks the PAYER's
          // client, not whoever the counter-patch route last touched — this
          // route is now the only place that flips is_payer for an existing
          // group, so it must also re-sync transactions.client_id itself
          // (transactions-counter-patch.ts's EXISTS(is_payer=TRUE) sync only
          // fires from ITS OWN PATCH, not from this one).
          await dbClient.query(
            `UPDATE accounts.transactions t
                SET client_id = cg.client_id
               FROM accounts.transaction_customer_groups cg
              WHERE t.id = $1 AND t.workspace_id = $2
                AND cg.id = $3 AND cg.transaction_id = $1 AND cg.workspace_id = $2`,
            [id, workspaceId, payerTarget],
          );
        }

        // Payer-integrity guard: a save must never leave is_payer=TRUE on a
        // customer_group with zero active lines while ANOTHER group on the
        // same transaction still holds active lines and no reassignment
        // resolved the conflict above. This is the server-side backstop for
        // the client-side remove/zero block — belt-and-suspenders, since a
        // stale client build or a direct API caller must not be able to
        // strand billing attribution on a $0 group.
        const payerRows = await dbClient.query<{ id: number; is_payer: boolean; has_active: boolean }>(
          `SELECT cg.id, cg.is_payer,
                  EXISTS (
                    SELECT 1 FROM accounts.transaction_line_items li
                     WHERE li.customer_group_id = cg.id AND li.transaction_id = $1 AND li.workspace_id = $2
                       AND li.status IN ('active', 'completed', 'expired')
                  ) AS has_active
             FROM accounts.transaction_customer_groups cg
            WHERE cg.transaction_id = $1 AND cg.workspace_id = $2`,
          [id, workspaceId],
        );
        const payerRow = payerRows.rows.find((r) => r.is_payer);
        const anyOtherHasActive = payerRows.rows.some((r) => !r.is_payer && r.has_active);
        if (payerRow != null && !payerRow.has_active && anyOtherHasActive) {
          await dbClient.query("ROLLBACK");
          return c.json(
            {
              error: "The payer's items were all removed. Reassign the payer to a customer with active items.",
              code: "PAYER_REASSIGNMENT_REQUIRED",
            },
            409,
          );
        }

        // Same-tx model: additions never land on a child transaction anymore,
        // so both guards below compare against this transaction's own rows
        // only — no family/child union.
        const remainingCount = await dbClient.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM accounts.transaction_line_items
             WHERE transaction_id = $1 AND workspace_id = $2 AND status IN ('active', 'completed', 'expired')`,
          [id, workspaceId],
        );
        if (parseInt(remainingCount.rows[0].n, 10) === 0) {
          await dbClient.query("ROLLBACK");
          return c.json(
            { error: "At least one item must remain on this receipt. Void the whole transaction instead.", code: "EMPTY_CART" },
            409,
          );
        }

        // The detail modal title (TransactionsPage.tsx) and the edit-form
        // seed (useTransactionForm.ts) both render the stored column
        // directly, unlike the list route's own LATERAL derivation — a swap
        // here left them showing the voided package's name until this
        // regenerate. remainingCount above already guarantees at least one
        // active line survives, so a null summary here would only mean a
        // race with a concurrent void outside this transaction; NULL-safe
        // COALESCE keeps the existing description rather than blank it.
        const freshDescription = await deriveActiveLineSummary(dbClient, id, workspaceId, idh);
        if (freshDescription != null) {
          await dbClient.query(
            `UPDATE accounts.transactions SET description = $1 WHERE id = $2 AND workspace_id = $3`,
            [freshDescription, id, workspaceId],
          );
        }

        const finalRes = await dbClient.query<{
          id: number;
          amount: string;
          subtotal: string | null;
          discount_amount: string;
        }>(
          `SELECT id, amount, subtotal, discount_amount FROM accounts.transactions
             WHERE id = $1 AND workspace_id = $2`,
          [id, workspaceId],
        );
        const finalTxn = finalRes.rows[0];
        const paidRes = await dbClient.query<{ total_paid: string }>(
          `SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS total_paid
             FROM accounts.transaction_payments WHERE transaction_id = $1 AND workspace_id = $2`,
          [id, workspaceId],
        );
        const newAmount = parseFloat(finalTxn.amount);
        const totalPaid = parseFloat(paidRes.rows[0].total_paid);
        if (newAmount < totalPaid) {
          await dbClient.query("ROLLBACK");
          return c.json(
            {
              error: `This would reduce the total below the ₱${totalPaid} already paid. Refunds are handled manually.`,
              code: "REFUND_BLOCKED",
              new_total: newAmount,
              already_paid: totalPaid,
            },
            409,
          );
        }

        const responseBody = {
          transaction: {
            id: finalTxn.id,
            amount: newAmount,
            subtotal: finalTxn.subtotal != null ? parseFloat(finalTxn.subtotal) : null,
            discount_amount: parseFloat(finalTxn.discount_amount),
            balance: Math.max(0, newAmount - totalPaid),
            payment_status: newAmount === 0 || totalPaid >= newAmount ? "paid" : totalPaid > 0 ? "partial" : "unpaid",
          },
          voided_line_item_ids: voidedLineItemIds,
          reduced_line_items: reducedLineItems,
          added_line_item_ids: addedLineItemIds,
          new_customer_group_ids: newCustomerGroupIds,
        };

        // transaction_edits is INSERT/SELECT-only under RLS (append-only audit
        // trail, no UPDATE policy) — payload is stored WITHOUT edit_id (self-
        // referential, only known after this INSERT) and edit_id is merged
        // in from the row's own id on every read, matching the replay branch.
        // kind stays 'cart_reduction' even for an additions-only or mixed
        // call — it already reads as "an edit to the cart," and renaming it
        // would touch the existing idempotency-replay/audit tests for no
        // functional gain.
        const editRes = await dbClient.query<{ id: number }>(
          `INSERT INTO accounts.transaction_edits
             (transaction_id, workspace_id, edited_by, reason, kind, idempotency_key, payload)
           VALUES ($1, $2, $3, $4, 'cart_reduction', $5, $6::jsonb)
           RETURNING id`,
          [id, workspaceId, userId ?? "", String(reason).trim(), String(editToken).trim(), JSON.stringify(responseBody)],
        );

        await dbClient.query("COMMIT");
        return c.json({ ...responseBody, edit_id: editRes.rows[0].id });
      } catch (err) {
        if (dbClient) await dbClient.query("ROLLBACK").catch(() => {});
        console.error("[transactions] apply-cart-edit error:", err);
        return c.json({ error: "Internal server error" }, 500);
      } finally {
        if (dbClient) dbClient.release();
      }
    },
  );
}
