// The POS charge engine for the isolated transactions plugin.
//
// Extracted VERBATIM from helpers-charge.ts on the existing function seam:
// the ChargeConnectHandle type + runCharge. One accounts.transactions row +
// one accounts.transaction_line_items row per cart line + one optional
// accounts.transaction_payments leg, all inside a single DB transaction. The
// two parent-transaction INSERT blocks (multi-customer + legacy single) are
// byte-for-byte unchanged, with no $N param renumbering. No SQL, no logic, no
// signature changes. The original public surface is re-exported from the
// helpers-charge.ts barrel so callers keep importing from there.
//
// What changed from the monolith (and why):
//   - Package/variant validation goes through packages.findVariantsByIds over
//     RPC. If the packages plugin is OFF, lines that carry a package_id/
//     package_variant_id are REJECTED with a clear message (manual line items
//     with no package ref still work). This is the graceful-degradation
//     contract for the producer transactions DEPENDS on at charge time.
//   - Voucher discount goes through vouchers.validate / findByCode over RPC.
//     If the vouchers plugin is OFF, no discount is applied and the charge
//     proceeds at full subtotal.
//   - Voucher usage increment is NOT part of the charge DB transaction (it
//     can't be — the producer is a separate process). The route does a
//     best-effort increment after commit; see routes.ts. A failed increment
//     never rolls back a committed charge.
//   - The monolith's `links.create` shadow-write (a Phase-8 migration artifact)
//     is dropped — there is no cross-process links runner and the in-row FK
//     column (package_variant_id) is the source of truth here.
//   - Client-name attribution is resolved on READ via clients.findByIds, not
//     joined in SQL; the charge just stores client_id.

import type { Pool, PoolClient } from "pg";
import { applyTenantContext } from "@kahitsan/plugin-sdk";
import { computeVoucherDiscount, type VoucherForDiscount } from "../lib/voucher-discount.js";
import {
  findVariantsByIds,
  findVoucherByCode,
  findVoucherById,
  type IdentityHeader,
  type PackageVariantRow,
} from "../lib/peers.js";
import {
  ChargeValidationError,
  validateChargePayload,
  type ChargeCustomerGroup,
  type ChargePayload,
  type ChargeResult,
} from "./validate.js";
import {
  assertOrgOwnsRow,
  insertLineItemsForTransaction,
} from "./insert-line-items.js";
import { tryProbeVoucher } from "./probe-voucher.js";

export type ChargeConnectHandle = { connect(): Promise<PoolClient> };

export async function runCharge(opts: {
  pool: ChargeConnectHandle | Pool;
  workspaceId: number;
  userId: string;
  identityHeader: IdentityHeader;
  payload: ChargePayload;
}): Promise<ChargeResult> {
  validateChargePayload(opts.payload);
  const { payload, workspaceId, userId, identityHeader } = opts;

  // ── Package validation via RPC (graceful degradation) ──────────────────
  // Collect the package refs the cart carries. If ANY line carries a package
  // ref and the packages plugin is OFF, reject — we cannot price/validate it.
  const variantIds = [
    ...new Set(
      payload.items
        .map((l) => l.package_variant_id)
        .filter((v): v is number => typeof v === "number"),
    ),
  ];
  let packagesAvailable = true;
  if (variantIds.length > 0) {
    const variants = await findVariantsByIds(variantIds, identityHeader);
    if (variants == null) {
      // packages plugin not loaded
      throw new ChargeValidationError(
        503,
        "This cart references packages, but the packages plugin is not available. Remove package line items or enable the packages plugin.",
      );
    }
    // Validate every referenced variant exists (org-scoped by the producer)
    // and that variant.package_id matches the line's package_id.
    const variantById = new Map<number, PackageVariantRow>(variants.map((v) => [v.id, v]));
    for (const line of payload.items) {
      if (line.package_variant_id == null) continue;
      const variant = variantById.get(line.package_variant_id);
      if (variant == null || variant.package_id !== line.package_id) {
        throw new ChargeValidationError(
          404,
          "package_variant_id not found under package_id in this workspace",
        );
      }
    }
  }

  // ── Voucher discount via RPC (graceful degradation) ────────────────────
  const subtotal = payload.items.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  let discount = 0;
  let voucherApplied: { code: string; discount: number } | null = null;
  let vouchersAvailable = true;
  if (payload.voucher_code && payload.voucher_code.trim()) {
    const code = payload.voucher_code.trim();
    // findByCode returns the voucher row (or null when absent / no such code).
    const voucher = await findVoucherByCode(code, identityHeader);
    if (voucher === null) {
      // Could be EITHER vouchers plugin absent OR code not found. Probe with
      // validate to disambiguate: validate returns null only when the plugin
      // is absent; otherwise { valid:false, reason }.
      const probe = await tryProbeVoucher(code, workspaceId, payload, identityHeader);
      if (probe === "unavailable") {
        vouchersAvailable = false;
        // Graceful degradation: proceed at full subtotal, no discount.
      } else {
        throw new ChargeValidationError(400, "voucher code is invalid or not applicable");
      }
    } else {
      // Compute the discount locally from the voucher row (same math the
      // monolith used). Min-purchase / applicability are best validated by the
      // vouchers plugin; we do a light local min-purchase check.
      const minPurchase =
        voucher.minimum_purchase != null ? Number(voucher.minimum_purchase) : 0;
      if (minPurchase > 0 && subtotal < minPurchase) {
        throw new ChargeValidationError(400, "subtotal below voucher minimum_purchase");
      }
      const computed = computeVoucherDiscount(subtotal, voucher as unknown as VoucherForDiscount);
      discount = computed.discountAmount;
      voucherApplied = { code: voucher.code, discount };
    }
  } else if (typeof payload.discount_amount === "number" && payload.discount_amount > 0) {
    // Manual discount (no voucher) — trusted as in the monolith.
    discount = payload.discount_amount;
  }

  // ── Per-customer-group voucher discounts ───────────────────────────────────
  // The new multi-customer POS attaches a voucher per customer and sends only
  // its id (no top-level voucher_code, no client-computed discount). Resolve
  // each voucher over the vouchers findById RPC and compute its discount
  // against THAT group's subtotal — the same math computeVoucherDiscount runs
  // for the top-level voucher_code path, and the same math the UI previews. The
  // per-group amounts land on each customer_group row (so breakdown reads stay
  // simple) and sum into the parent `discount` so the persisted total matches
  // what the cashier collected. Indexed parallel to payload.customer_groups.
  const perGroupDiscount: number[] = [];
  const perGroupVoucherId: (number | null)[] = [];
  if (Array.isArray(payload.customer_groups) && payload.customer_groups.length > 0) {
    const groups = payload.customer_groups as ChargeCustomerGroup[];
    const groupSub = new Array<number>(groups.length).fill(0);
    for (let gi = 0; gi < groups.length; gi++) {
      for (const li of groups[gi].item_indices) {
        groupSub[gi] += payload.items[li].quantity * payload.items[li].unit_price;
      }
    }
    for (let gi = 0; gi < groups.length; gi++) {
      const vid = groups[gi].voucher_id ?? null;
      // Default to NOT persisting a voucher reference. transaction_customer_
      // groups.voucher_id carries an FK to vouchers(id), so a voucher_id that
      // doesn't resolve in THIS org must be dropped (storing it would abort the
      // charge on the FK). Only a confirmed-present voucher is persisted below.
      perGroupVoucherId[gi] = null;
      perGroupDiscount[gi] = 0;
      if (vid == null) continue;
      const voucher = await findVoucherById(vid, identityHeader);
      if (voucher === null) {
        // vouchers plugin absent OR no such id in this org. Degrade like the
        // top-level voucher_code path: proceed at full subtotal, no discount,
        // and don't persist the dangling reference.
        vouchersAvailable = false;
        continue;
      }
      perGroupVoucherId[gi] = vid;
      const minPurchase =
        voucher.minimum_purchase != null ? Number(voucher.minimum_purchase) : 0;
      if (minPurchase > 0 && groupSub[gi] < minPurchase) {
        throw new ChargeValidationError(
          400,
          `customer_groups[${gi}] subtotal below voucher minimum_purchase`,
        );
      }
      const computed = computeVoucherDiscount(
        groupSub[gi],
        voucher as unknown as VoucherForDiscount,
      );
      perGroupDiscount[gi] = computed.discountAmount;
      discount += computed.discountAmount;
    }
  }

  const total = Math.max(0, subtotal - discount);
  const txDescription = payload.items
    .slice(0, 3)
    .map((l) => `${l.quantity}× ${l.description}`)
    .join(", ");
  const useCustomDate = payload.transaction_date != null && payload.started_at != null;
  // Multi-customer charges anchor per-line via customer_groups[].started_at,
  // so the parent transaction takes its date from transaction_date alone
  // (or CURRENT_DATE when absent). Top-level started_at is forbidden here.
  const hasGroups =
    Array.isArray(payload.customer_groups) && payload.customer_groups.length > 0;
  const hasParentDate = hasGroups && payload.transaction_date != null;
  const backdateReason =
    typeof payload.backdate_reason === "string" && payload.backdate_reason.trim()
      ? payload.backdate_reason.trim()
      : null;
  const notes =
    typeof payload.notes === "string" && payload.notes.trim() ? payload.notes.trim() : null;

  let client: PoolClient | null = null;
  try {
    client = await opts.pool.connect();
    await client.query("BEGIN");
    await applyTenantContext(client);

    // destination_account_id is a SOFT ref to financial-accounts' table — we
    // can't org-check it here (other plugin's schema), so we trust the FK-less
    // soft ref. parent_transaction_id, by contrast, is OUR table.
    if (payload.parent_transaction_id != null) {
      await assertOrgOwnsRow(
        client,
        "accounts.transactions",
        payload.parent_transaction_id,
        workspaceId,
        "parent_transaction_id",
      );
    }

    let txn: Record<string, unknown>;
    let lineItems: Array<Record<string, unknown>>;

    if (hasGroups) {
      // ── Multi-customer path ──────────────────────────────────────────────
      const groups = payload.customer_groups as ChargeCustomerGroup[];
      const payerGroup = groups.find((g) => g.is_payer) as ChargeCustomerGroup;
      const payerClientId = payerGroup.client_id ?? null;

      // Index map: which group owns which line index. The validator
      // guarantees a clean partition.
      const groupOfLine = new Map<number, number>();
      for (let gi = 0; gi < groups.length; gi++) {
        for (const lineIdx of groups[gi].item_indices) {
          groupOfLine.set(lineIdx, gi);
        }
      }
      // Per-group subtotals (pre-discount). Stored on each group row so
      // breakdown reads stay simple. Per-group voucher math is deferred
      // (rejected at validation time); discount stays at the parent.
      const perGroupSubtotal = new Array<number>(groups.length).fill(0);
      for (let i = 0; i < payload.items.length; i++) {
        const gi = groupOfLine.get(i) as number;
        perGroupSubtotal[gi] += payload.items[i].quantity * payload.items[i].unit_price;
      }

      // Batch code stamps multi-customer receipts so staff can recognise rows
      // that belong to the same group booking at a glance. Only assigned for
      // 2+ customers; the UI prefixes "BA" at the display layer.
      const batchCode =
        groups.length > 1
          ? ((
              await client.query<{ code: number }>(
                `SELECT nextval('accounts.transaction_batch_code_seq')::int AS code`,
              )
            ).rows[0]?.code ?? null)
          : null;

      // Parent transaction. client_id mirrors the payer's client (or NULL
      // when payer is walk-in). transaction_date defaults to CURRENT_DATE
      // when absent; per-line started_at is set from each cg's anchor below.
      const txResult = await client.query(
        `INSERT INTO accounts.transactions
           (workspace_id, category, subcategory, destination_account_id, amount, description,
            notes,
            transaction_date, status, created_by,
            tax_type, tax_rate, tax_amount, subtotal,
            client_id, discount_amount,
            is_backdated, backdate_reason,
            parent_transaction_id, batch_code)
         VALUES ($1, 'sale', 'Sales - services', $2, $3, $4,
                 $9,
                 COALESCE($7::date, CURRENT_DATE), 'completed', $5,
                 'vat_inclusive', 0, 0, $12,
                 $6, $8,
                 COALESCE($7::date, CURRENT_DATE) < CURRENT_DATE,
                 CASE WHEN COALESCE($7::date, CURRENT_DATE) < CURRENT_DATE THEN $10 ELSE NULL END,
                 $11, $13)
         RETURNING *`,
        [
          workspaceId, // $1
          payload.destination_account_id, // $2
          total, // $3
          txDescription || "Counter availment", // $4
          userId, // $5
          payerClientId, // $6
          hasParentDate ? payload.transaction_date : null, // $7
          discount, // $8
          notes, // $9
          backdateReason, // $10
          payload.parent_transaction_id ?? null, // $11
          subtotal, // $12
          batchCode, // $13
        ],
      );
      txn = txResult.rows[0];

      // Insert customer_groups in one multi-row INSERT, capture ids in
      // insertion order. PG guarantees RETURNING rows come back in VALUES
      // order, so groupRowIds[i] maps to groups[i]. 10 params per row.
      const groupParams: unknown[] = [];
      const groupValuesTuples: string[] = [];
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const base = gi * 10;
        groupValuesTuples.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`,
        );
        groupParams.push(
          txn.id,
          workspaceId,
          gi,
          g.client_id ?? null,
          g.display_name.trim(),
          typeof g.note === "string" && g.note.trim() ? g.note.trim() : null,
          // Per-group voucher + the discount it produced (computed above).
          perGroupVoucherId[gi] ?? null,
          perGroupSubtotal[gi],
          perGroupDiscount[gi] ?? 0,
          g.is_payer,
        );
      }
      const groupBatchRes = await client.query<{ id: number }>(
        `INSERT INTO accounts.transaction_customer_groups
           (transaction_id, workspace_id, position,
            client_id, display_name, note, voucher_id,
            subtotal, discount_amount, is_payer)
         VALUES ${groupValuesTuples.join(", ")}
         RETURNING id`,
        groupParams,
      );
      const groupRowIds = groupBatchRes.rows.map((r) => r.id);

      // Build per-line attribution arrays (parallel to payload.items[]).
      // perLineStartedAt mirrors each cg's started_at: a string pins that
      // line's anchor; an explicit null forces NOW(); undefined would fall
      // back to the global anchor. Under the multi-customer contract we
      // always provide an explicit choice, so the global anchor never fires.
      const perLineCustomerGroupIds: (number | null)[] = new Array(payload.items.length).fill(
        null,
      );
      const perLineClientIds: (number | null)[] = new Array(payload.items.length).fill(null);
      const perLineStartedAt: (string | null)[] = new Array(payload.items.length).fill(null);
      for (let i = 0; i < payload.items.length; i++) {
        const gi = groupOfLine.get(i) as number;
        perLineCustomerGroupIds[i] = groupRowIds[gi];
        perLineClientIds[i] = groups[gi].client_id ?? null;
        const cgStartedAt = groups[gi].started_at;
        perLineStartedAt[i] =
          typeof cgStartedAt === "string" && cgStartedAt.length > 0 ? cgStartedAt : null;
      }

      lineItems = await insertLineItemsForTransaction(
        client,
        txn.id as number,
        workspaceId,
        payerClientId,
        payload.items,
        {
          anchor: "now",
          initialStatus: (txn.is_backdated as boolean) ? "completed" : "active",
          perLineCustomerGroupIds,
          perLineClientIds,
          perLineStartedAt,
        },
      );
    } else {
      // ── Legacy single-customer path ──────────────────────────────────────
      const txResult = await client.query(
        `INSERT INTO accounts.transactions
           (workspace_id, category, subcategory, destination_account_id, amount, description,
            notes,
            transaction_date, status, created_by,
            tax_type, tax_rate, tax_amount, subtotal,
            client_id, discount_amount,
            is_backdated, backdate_reason,
            parent_transaction_id)
         VALUES ($1, 'sale', 'Sales - services', $2, $3, $4,
                 $9,
                 COALESCE($7::date, CURRENT_DATE), 'completed', $5,
                 'vat_inclusive', 0, 0, $3,
                 $6, $8,
                 COALESCE($7::date, CURRENT_DATE) < CURRENT_DATE,
                 CASE WHEN COALESCE($7::date, CURRENT_DATE) < CURRENT_DATE THEN $10 ELSE NULL END,
                 $11)
         RETURNING *`,
        [
          workspaceId, // $1
          payload.destination_account_id, // $2
          total, // $3
          txDescription || "Counter availment", // $4
          userId, // $5
          payload.client_id ?? null, // $6
          useCustomDate ? payload.transaction_date : null, // $7
          discount, // $8
          notes, // $9
          backdateReason, // $10
          payload.parent_transaction_id ?? null, // $11
        ],
      );
      txn = txResult.rows[0];

      lineItems = useCustomDate
        ? await insertLineItemsForTransaction(
            client,
            txn.id as number,
            workspaceId,
            payload.client_id ?? null,
            payload.items,
            {
              anchor: "started_at",
              startedAt: payload.started_at as string,
              initialStatus: (txn.is_backdated as boolean) ? "completed" : "active",
            },
          )
        : await insertLineItemsForTransaction(
            client,
            txn.id as number,
            workspaceId,
            payload.client_id ?? null,
            payload.items,
            { anchor: "now", initialStatus: "active" },
          );
    }

    // Client pool persistence. Multi-customer charges aggregate
    // payload.client_ids (primaries + multi-occupant extras) when present;
    // otherwise fall back to groups[*].client_id (multi-customer) or
    // [client_id] (single-customer). Same dedup semantics either way.
    const poolIds: number[] = [];
    const seenPool = new Set<number>();
    if (Array.isArray(payload.client_ids)) {
      for (const cid of payload.client_ids) {
        if (typeof cid !== "number" || !Number.isFinite(cid)) continue;
        if (seenPool.has(cid)) continue;
        poolIds.push(cid);
        seenPool.add(cid);
      }
    } else if (hasGroups) {
      for (const g of payload.customer_groups as ChargeCustomerGroup[]) {
        if (g.client_id != null && !seenPool.has(g.client_id)) {
          poolIds.push(g.client_id);
          seenPool.add(g.client_id);
        }
      }
    } else if (payload.client_id != null) {
      poolIds.push(payload.client_id);
      seenPool.add(payload.client_id);
    }
    if (poolIds.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      for (let i = 0; i < poolIds.length; i++) {
        values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(txn.id, poolIds[i], workspaceId, i);
      }
      await client.query(
        `INSERT INTO accounts.transaction_customers
           (transaction_id, client_id, workspace_id, position)
         VALUES ${values.join(", ")}
         ON CONFLICT (transaction_id, client_id) DO UPDATE SET position = EXCLUDED.position`,
        params,
      );
    }

    // Payment ledger leg. Capped at the billed total; overpay = change, never
    // persisted; zero collected = no leg.
    const requestedCollected =
      typeof payload.amount_collected === "number" ? payload.amount_collected : total;
    const cappedCollected = Math.min(requestedCollected, total);
    if (cappedCollected > 0) {
      await client.query(
        `INSERT INTO accounts.transaction_payments
           (transaction_id, workspace_id, financial_account_id, amount, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NULL, NOW(), NOW())`,
        [txn.id, workspaceId, payload.destination_account_id, cappedCollected],
      );
    }

    await client.query("COMMIT");

    return {
      transaction: txn,
      line_items: lineItems,
      voucher_applied: voucherApplied,
      packages_available: packagesAvailable,
      vouchers_available: vouchersAvailable,
    };
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (client) client.release();
  }
}
