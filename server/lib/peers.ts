// Cross-plugin peer access over the kernel RPC gateway.
//
// In the monolith, transactions reached packages / vouchers / clients through
// in-process extension points (live closures, same DB transaction). Those
// can't cross a process boundary, so this module wraps the kernel's HTTP RPC
// (kernel/service-rpc → tryCallPlugin) instead. Every call relays the SAME
// kernel-signed identity header transactions received, so the peer runs the
// query as the original user/workspace and scopes it to req.workspaceId itself.
//
// GRACEFUL DEGRADATION is the whole point of using tryCallPlugin (not
// callPlugin): when a peer plugin isn't loaded the kernel answers 503 and
// tryCallPlugin returns null. Callers here translate that into a
// peer-unavailable signal so transactions still works standalone:
//   - packages absent  → package line-items are rejected at /charge with a
//                         clear message (manual sales line items still work),
//                         and package/variant names are simply omitted on reads.
//   - vouchers absent   → no voucher discount is applied; the charge proceeds
//                         at full subtotal.
//   - clients absent    → line items / receipts store client_id only; names
//                         are omitted.
//
// CROSS-PROCESS CAVEAT: the monolith locked the voucher row inside the charge's
// DB transaction (SELECT ... FOR UPDATE) and incremented usage_count in the
// same commit. That atomicity cannot span two processes. We validate the
// voucher over RPC and compute the discount, but we DO NOT increment usage as
// part of the charge transaction — see chargeFlow's best-effort note.

import { tryCallPlugin, type PluginUnavailableError } from "@kahitsan/plugin-sdk";

export type IdentityHeader = string | undefined;

// Numeric columns arrive from pg as a string (numeric/decimal), a number, or
// null. VoucherType is the voucher discount kind. Aliased so the repeated
// unions read as one named shape.
export type Numeric = string | number | null;
export type VoucherType = "percentage" | "fixed_amount" | "free";

// ── packages ───────────────────────────────────────────────────────────────

export interface PackageVariantRow {
  id: number;
  package_id: number;
  name: string;
  kind: string | null;
  price: Numeric;
  currency: string | null;
  duration_value: Numeric;
  duration_unit: string | null;
  is_active: boolean;
}

export interface PackageRow {
  id: number;
  name: string;
  type: string | null;
  capacity_limit: number | null;
  max_per_day: number | null;
  max_per_month: number | null;
  is_active: boolean;
  // Pricing-era lineage. The subscriptions view groups a client's renewals by
  // lineage_slug so eras of the same plan chain into one subscription, and uses
  // effective_to (NULL = current era) to default the renewal to a saleable
  // package. Older kernels' packages plugin may not send these, so both are
  // optional for back-compat.
  lineage_slug?: string | null;
  effective_to?: string | null;
}

/** Resolve package-variant rows by id via the packages plugin. Returns null
 *  when the packages plugin isn't loaded (graceful degradation). */
export async function findVariantsByIds(
  ids: number[],
  identityHeader: IdentityHeader,
): Promise<PackageVariantRow[] | null> {
  if (ids.length === 0) return [];
  return tryCallPlugin<PackageVariantRow[]>(
    "packages",
    "findVariantsByIds",
    { ids },
    { identityHeader },
  );
}

/** Resolve package rows by id via the packages plugin. Null when absent. */
export async function findPackagesByIds(
  ids: number[],
  identityHeader: IdentityHeader,
): Promise<PackageRow[] | null> {
  if (ids.length === 0) return [];
  return tryCallPlugin<PackageRow[]>("packages", "findPackagesByIds", { ids }, { identityHeader });
}

// ── vouchers ─────────────────────────────────────────────────────────────────

export interface VoucherValidateInput {
  code: string;
  packageId?: number;
  clientId?: number;
  subtotal?: number;
}

export interface VoucherValidateResult {
  valid: boolean;
  reason?: string;
  voucherId?: number;
  type?: VoucherType;
  value?: Numeric;
  voucher?: {
    id: number;
    code: string;
    type: VoucherType;
    value: Numeric;
    max_discount_amount?: Numeric;
    minimum_purchase?: Numeric;
  };
}

export interface VoucherRow {
  id: number;
  code: string;
  type: VoucherType;
  value: Numeric;
  max_discount_amount?: Numeric;
  minimum_purchase?: Numeric;
  is_active?: boolean;
}

/** Validate a voucher code against the vouchers plugin. Null when the vouchers
 *  plugin isn't loaded (graceful degradation — charge proceeds without a
 *  discount). */
export async function validateVoucher(
  input: VoucherValidateInput,
  identityHeader: IdentityHeader,
): Promise<VoucherValidateResult | null> {
  return tryCallPlugin<VoucherValidateResult>("vouchers", "validate", input, { identityHeader });
}

/** Look up a voucher row by code. Null when vouchers absent OR no such code. */
export async function findVoucherByCode(
  code: string,
  identityHeader: IdentityHeader,
): Promise<VoucherRow | null> {
  return tryCallPlugin<VoucherRow | null>("vouchers", "findByCode", { code }, { identityHeader });
}

/** Look up a voucher row by id. Null when vouchers absent OR no such id.
 *  Backs the per-customer-group voucher discount in the multi-customer charge:
 *  the new POS attaches a voucher per customer and sends only its id, so the
 *  charge route resolves the row here to compute the discount server-side. */
export async function findVoucherById(
  id: number,
  identityHeader: IdentityHeader,
): Promise<VoucherRow | null> {
  return tryCallPlugin<VoucherRow | null>("vouchers", "findById", { id }, { identityHeader });
}

// ── clients ──────────────────────────────────────────────────────────────────

export interface ClientRow {
  id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  // Optional: older kernels' clients plugin may not send phone. The
  // subscriptions table surfaces a tap-to-call link so staff can chase
  // expiring renewals.
  phone?: string | null;
}

/** Resolve client display rows by id via the clients plugin. Null when the
 *  clients plugin isn't loaded (graceful degradation — names omitted). */
export async function findClientsByIds(
  ids: number[],
  identityHeader: IdentityHeader,
): Promise<ClientRow[] | null> {
  if (ids.length === 0) return [];
  return tryCallPlugin<ClientRow[]>("clients", "findByIds", { ids }, { identityHeader });
}

// ── financial-accounts ───────────────────────────────────────────────────────

export interface AccountRow {
  id: number;
  name: string;
  type: string | null;
  icon: string | null;
  color: string | null;
  s3_link: string | null;
}

/** Resolve financial-account display rows by id via the financial-accounts
 *  plugin. Null when that plugin isn't loaded — callers surface a "couldn't
 *  load" marker rather than a wrong/empty name. Deliberately NOT in manifest
 *  `requires`: name enrichment is an optional read, so transactions must keep
 *  serving the list even when financial-accounts is absent (an unsatisfied
 *  `requires` would make the loader skip transactions entirely). */
export async function findAccountsByIds(
  ids: number[],
  identityHeader: IdentityHeader,
): Promise<AccountRow[] | null> {
  if (ids.length === 0) return [];
  return tryCallPlugin<AccountRow[]>(
    "financial-accounts",
    "findByIds",
    { ids },
    { identityHeader },
  );
}

// ── payees ───────────────────────────────────────────────────────────────────

export interface PayeeRow {
  id: number;
  name: string;
  kind: string | null;
}

/** Resolve payee display rows by id via the payees plugin. Null when the payees
 *  plugin isn't loaded (graceful degradation — see findAccountsByIds). */
export async function findPayeesByIds(
  ids: number[],
  identityHeader: IdentityHeader,
): Promise<PayeeRow[] | null> {
  if (ids.length === 0) return [];
  return tryCallPlugin<PayeeRow[]>("payees", "findByIds", { ids }, { identityHeader });
}

// Re-export for callers that want to distinguish unavailable from other errors.
export type { PluginUnavailableError };
