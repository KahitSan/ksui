// Counter "charge" (POS) flow for the isolated transactions plugin.
//
// Faithful port of the monolith's helpers-charge.ts core path, with the
// in-process extension points replaced by the kernel RPC (lib/peers.ts) and
// graceful degradation when a peer plugin is absent. One accounts.transactions
// row + one accounts.transaction_line_items row per cart line + one optional
// accounts.transaction_payments leg, all inside a single DB transaction.
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
import { computeVoucherDiscount, type VoucherForDiscount } from "./lib/voucher-discount.js";
import {
  findVariantsByIds,
  findVoucherByCode,
  type IdentityHeader,
  type PackageVariantRow,
} from "./lib/peers.js";

export interface ChargeLineInput {
  // package_id / package_variant_id are OPTIONAL here (unlike the monolith,
  // which always carried a package ref). A line with neither is a "manual"
  // line item that works even when the packages plugin is off.
  package_id?: number | null;
  package_variant_id?: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  duration_value?: number | null;
  duration_unit?: "hour" | "day" | "month" | null;
  client_id?: number | null;
}

export interface ChargePayload {
  destination_account_id: number;
  client_id?: number | null;
  client_ids?: number[] | null;
  // Either voucher_code (resolved over RPC) or no voucher. The monolith keyed
  // on voucher_id; the vouchers RPC validates by CODE, so the isolated charge
  // accepts a code.
  voucher_code?: string | null;
  discount_amount?: number;
  items: ChargeLineInput[];
  transaction_date?: string;
  started_at?: string;
  backdate_reason?: string | null;
  notes?: string | null;
  amount_collected?: number | null;
  parent_transaction_id?: number | null;
}

export interface ChargeResult {
  transaction: Record<string, unknown>;
  line_items: Array<Record<string, unknown>>;
  voucher_applied: { code: string; discount: number } | null;
  packages_available: boolean;
  vouchers_available: boolean;
}

const VALID_UNITS = ["hour", "day", "month"] as const;
type ValidUnit = (typeof VALID_UNITS)[number];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ChargeValidationError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ChargeValidationError";
  }
}

// Pure validator for the items[] array. Same shape rules as the monolith,
// except package refs are optional (a manual line item is allowed).
export function validateLineItems(items: unknown): asserts items is ChargeLineInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ChargeValidationError(400, "items must be a non-empty array");
  }
  for (const [idx, line] of items.entries()) {
    if (!line || typeof line !== "object") {
      throw new ChargeValidationError(400, `items[${idx}] must be an object`);
    }
    const l = line as Record<string, unknown>;
    if (typeof l.description !== "string" || !l.description.trim()) {
      throw new ChargeValidationError(400, `items[${idx}] missing description`);
    }
    if (typeof l.quantity !== "number" || !Number.isFinite(l.quantity) || l.quantity <= 0) {
      throw new ChargeValidationError(400, `items[${idx}].quantity must be > 0`);
    }
    if (typeof l.unit_price !== "number" || !Number.isFinite(l.unit_price) || l.unit_price < 0) {
      throw new ChargeValidationError(400, `items[${idx}].unit_price must be >= 0`);
    }
    // A package ref requires BOTH package_id and package_variant_id together,
    // or NEITHER (manual line). Half a ref is a malformed cart.
    const hasPkg = l.package_id != null;
    const hasVariant = l.package_variant_id != null;
    if (hasPkg !== hasVariant) {
      throw new ChargeValidationError(
        400,
        `items[${idx}] must carry both package_id and package_variant_id, or neither`,
      );
    }
    if (hasPkg) {
      if (typeof l.package_id !== "number" || !Number.isFinite(l.package_id) || l.package_id <= 0) {
        throw new ChargeValidationError(400, `items[${idx}].package_id must be a positive integer`);
      }
      if (
        typeof l.package_variant_id !== "number" ||
        !Number.isFinite(l.package_variant_id) ||
        l.package_variant_id <= 0
      ) {
        throw new ChargeValidationError(
          400,
          `items[${idx}].package_variant_id must be a positive integer`,
        );
      }
    }
    if (l.duration_unit != null) {
      if (
        typeof l.duration_unit !== "string" ||
        !(VALID_UNITS as readonly string[]).includes(l.duration_unit)
      ) {
        throw new ChargeValidationError(
          400,
          `items[${idx}].duration_unit must be one of: ${VALID_UNITS.join(", ")}`,
        );
      }
      if (
        typeof l.duration_value !== "number" ||
        !Number.isFinite(l.duration_value) ||
        l.duration_value <= 0
      ) {
        throw new ChargeValidationError(
          400,
          `items[${idx}].duration_value must be > 0 when duration_unit is set`,
        );
      }
    }
    if (l.client_id != null) {
      if (typeof l.client_id !== "number" || !Number.isFinite(l.client_id) || l.client_id <= 0) {
        throw new ChargeValidationError(400, `items[${idx}].client_id must be a positive integer`);
      }
    }
  }
}

export function validateChargePayload(payload: ChargePayload): void {
  if (typeof payload.destination_account_id !== "number" || payload.destination_account_id <= 0) {
    throw new ChargeValidationError(400, "destination_account_id is required");
  }
  validateLineItems(payload.items);
  const hasDate = payload.transaction_date != null;
  const hasTs = payload.started_at != null;
  if (hasDate !== hasTs) {
    throw new ChargeValidationError(
      400,
      "transaction_date and started_at must be provided together",
    );
  }
  if (hasDate) {
    if (
      typeof payload.transaction_date !== "string" ||
      !ISO_DATE_RE.test(payload.transaction_date)
    ) {
      throw new ChargeValidationError(400, "transaction_date must be YYYY-MM-DD");
    }
  }
  if (hasTs) {
    if (typeof payload.started_at !== "string" || Number.isNaN(Date.parse(payload.started_at))) {
      throw new ChargeValidationError(400, "started_at must be a valid ISO timestamp");
    }
  }
  if (payload.amount_collected != null) {
    if (
      typeof payload.amount_collected !== "number" ||
      !Number.isFinite(payload.amount_collected) ||
      payload.amount_collected < 0
    ) {
      throw new ChargeValidationError(400, "amount_collected must be a non-negative number");
    }
  }
  if (payload.voucher_code != null && typeof payload.voucher_code !== "string") {
    throw new ChargeValidationError(400, "voucher_code must be a string");
  }
}

function intervalSqlFor(unit: ValidUnit): string {
  if (unit === "hour") return "make_interval(hours => $8)";
  if (unit === "day") return "make_interval(days => $8)";
  return "make_interval(months => $8)";
}

// Confirms a financial account / client / transaction row exists in this org.
// SOFT references (financial_account_id) and clients live in OTHER plugins'
// schemas, so we can't check them here — those are validated by the producer
// plugin at write time only insofar as the FK target exists. We only assert
// rows in THIS plugin's own `accounts` schema.
async function assertOrgOwnsRow(
  client: PoolClient,
  table: string,
  id: number,
  organizationId: number,
  label: string,
): Promise<void> {
  const r = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${table} WHERE id = $1 AND organization_id = $2) AS exists`,
    [id, organizationId],
  );
  if (!r.rows[0]?.exists) {
    throw new ChargeValidationError(404, `${label} not found in this organization`);
  }
}

export interface InsertLineItemsOptions {
  anchor: "now" | "transaction_date" | "started_at";
  initialStatus: "active" | "completed";
  transactionDate?: string;
  startedAt?: string;
}

export async function insertLineItemsForTransaction(
  client: PoolClient,
  transactionId: number,
  organizationId: number,
  parentClientId: number | null,
  items: ChargeLineInput[],
  options: InsertLineItemsOptions,
): Promise<Array<Record<string, unknown>>> {
  if (options.anchor === "transaction_date" && !options.transactionDate) {
    throw new Error("transactionDate is required for anchor='transaction_date'");
  }
  if (options.anchor === "started_at" && !options.startedAt) {
    throw new Error("startedAt is required for anchor='started_at'");
  }
  const lineItems: Array<Record<string, unknown>> = [];
  for (const line of items) {
    const hasDuration = line.duration_unit != null && line.duration_value != null;
    const totalUnits = hasDuration ? (line.duration_value as number) * line.quantity : 0;
    const lineClientId = line.client_id ?? parentClientId ?? null;

    const startedAtExpr =
      options.anchor === "now"
        ? "NOW()"
        : options.anchor === "transaction_date"
          ? "($14::date)::timestamptz"
          : "($14::timestamptz)";
    // ends_at: only computed when the line carries a duration; otherwise NULL.
    // The no-duration branch still REFERENCES $8 (total units) so Postgres can
    // determine its type — $8 is always bound in `params`, and a param bound
    // but never referenced raises "could not determine data type of parameter
    // $8". The CASE always yields NULL and is cast to timestamptz so the value
    // assigns cleanly to the ends_at column (a bare NULLIF would infer numeric).
    const endsAtExpr = hasDuration
      ? `${startedAtExpr} + ${intervalSqlFor(line.duration_unit as ValidUnit)}`
      : "(CASE WHEN $8::numeric IS NULL THEN NULL ELSE NULL END)::timestamptz";

    const params: Array<string | number | null> = [
      transactionId, // $1
      organizationId, // $2
      line.package_id ?? null, // $3
      line.package_variant_id ?? null, // $4
      line.description, // $5
      line.quantity, // $6
      line.unit_price, // $7
      totalUnits, // $8 — used inside make_interval
      line.duration_value ?? null, // $9
      line.duration_unit ?? null, // $10
      lineClientId, // $11
      options.initialStatus, // $12
      null, // $13 — customer_group_id (single-customer path)
    ];
    if (options.anchor === "transaction_date") params.push(options.transactionDate as string); // $14
    else if (options.anchor === "started_at") params.push(options.startedAt as string); // $14

    const liResult = await client.query(
      `INSERT INTO accounts.transaction_line_items
         (transaction_id, organization_id, package_id, package_variant_id,
          description, quantity, unit_price,
          duration_value, duration_unit, started_at, ends_at, status,
          client_id, customer_group_id)
       VALUES ($1, $2, $3, $4,
               $5, $6, $7,
               $9, $10, ${startedAtExpr},
               ${endsAtExpr},
               $12,
               $11, $13)
       RETURNING *`,
      params,
    );
    lineItems.push(liResult.rows[0]);
  }
  return lineItems;
}

export type ChargeConnectHandle = { connect(): Promise<PoolClient> };

export async function runCharge(opts: {
  pool: ChargeConnectHandle | Pool;
  organizationId: number;
  userId: string;
  identityHeader: IdentityHeader;
  payload: ChargePayload;
}): Promise<ChargeResult> {
  validateChargePayload(opts.payload);
  const { payload, organizationId, userId, identityHeader } = opts;

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
      packagesAvailable = false;
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
          "package_variant_id not found under package_id in this organization",
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
      const probe = await tryProbeVoucher(code, organizationId, payload, identityHeader);
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

  const total = Math.max(0, subtotal - discount);
  const txDescription = payload.items
    .slice(0, 3)
    .map((l) => `${l.quantity}× ${l.description}`)
    .join(", ");
  const useCustomDate = payload.transaction_date != null && payload.started_at != null;
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

    // destination_account_id is a SOFT ref to financial-accounts' table — we
    // can't org-check it here (other plugin's schema), so we trust the FK-less
    // soft ref. parent_transaction_id, by contrast, is OUR table.
    if (payload.parent_transaction_id != null) {
      await assertOrgOwnsRow(
        client,
        "accounts.transactions",
        payload.parent_transaction_id,
        organizationId,
        "parent_transaction_id",
      );
    }

    const txResult = await client.query(
      `INSERT INTO accounts.transactions
         (organization_id, category, subcategory, destination_account_id, amount, description,
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
        organizationId, // $1
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
    const txn = txResult.rows[0];

    const lineItems = useCustomDate
      ? await insertLineItemsForTransaction(
          client,
          txn.id,
          organizationId,
          payload.client_id ?? null,
          payload.items,
          {
            anchor: "started_at",
            startedAt: payload.started_at as string,
            initialStatus: txn.is_backdated ? "completed" : "active",
          },
        )
      : await insertLineItemsForTransaction(
          client,
          txn.id,
          organizationId,
          payload.client_id ?? null,
          payload.items,
          { anchor: "now", initialStatus: "active" },
        );

    // Client pool persistence.
    const poolIds: number[] = Array.isArray(payload.client_ids)
      ? Array.from(
          new Set(payload.client_ids.filter((v) => typeof v === "number" && Number.isFinite(v))),
        )
      : payload.client_id != null
        ? [payload.client_id]
        : [];
    if (poolIds.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      for (let i = 0; i < poolIds.length; i++) {
        values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(txn.id, poolIds[i], organizationId, i);
      }
      await client.query(
        `INSERT INTO accounts.transaction_customers
           (transaction_id, client_id, organization_id, position)
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
           (transaction_id, organization_id, financial_account_id, amount, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NULL, NOW(), NOW())`,
        [txn.id, organizationId, payload.destination_account_id, cappedCollected],
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

// Disambiguates "vouchers plugin absent" from "code not found" by calling the
// vouchers `validate` RPC, which returns null only when the plugin is absent.
async function tryProbeVoucher(
  code: string,
  _organizationId: number,
  payload: ChargePayload,
  identityHeader: IdentityHeader,
): Promise<"unavailable" | "invalid"> {
  const { validateVoucher } = await import("./lib/peers.js");
  const subtotal = payload.items.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const result = await validateVoucher(
    {
      code,
      packageId: payload.items.find((l) => l.package_id != null)?.package_id ?? undefined,
      clientId: payload.client_id ?? undefined,
      subtotal,
    },
    identityHeader,
  );
  return result == null ? "unavailable" : "invalid";
}
