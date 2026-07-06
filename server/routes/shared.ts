// Shared route context for the transactions router: the constants, the
// validation/escaping helpers, the user-name batch resolver, and the privacy
// WHERE fragment that every list-style read reuses. Extracted verbatim from
// routes.ts so the per-resource route modules can share one source of truth.
// privacyClause keeps the exact PrivacyClause signature lib/subscriptions.ts
// expects: (req, params, startIdx) => string | null.

import type { Context } from "hono";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { isWorkspaceElevated } from "../types.js";

export const SORTABLE_COLUMNS = [
  "transaction_date",
  "amount",
  "category",
  "status",
  "description",
  "created_at",
];
export const VALID_CATEGORIES = ["expense", "sale", "business", "payable"];
export const VALID_STATUSES = ["pending", "completed", "voided"];
export const VALID_TAX_TYPES = ["vat_inclusive", "vat_exclusive", "vat_exempt", "non_vat"];
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Escape ILIKE wildcards so a search for "100%" doesn't match every row.
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/** Batch-resolve user ids to { id, name, image } from the kernel's user table. */
export async function resolveUserNames(
  pool: PluginDb,
  ids: Set<string>,
): Promise<Map<string, { name: string; image: string | null }>> {
  const arr = [...ids].filter(Boolean);
  if (arr.length === 0) return new Map();
  const result = await pool.query(
    `SELECT id, name, image FROM public."user" WHERE id = ANY($1::text[])`,
    [arr],
  );
  return new Map(result.rows.map((r: { id: string; name: string; image: string | null }) => [r.id, { name: r.name, image: r.image }]));
}

export interface TransactionListFilters {
  subcategory?: string;
  status?: string;
  accountId?: string;
  createdBy?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

/**
 * Companion to applyTransactionListFilters: reads the shared filter params off the
 * request one way, so the list route and grouped-by-date parse them identically.
 * (Each route reads its own non-shared params — category, sort, page, limit.)
 */
export function parseTransactionListQuery(c: Context): TransactionListFilters {
  return {
    subcategory: c.req.query("subcategory") as string | undefined,
    status: c.req.query("status") as string | undefined,
    accountId: c.req.query("accountId") as string | undefined,
    createdBy: c.req.query("createdBy") as string | undefined,
    dateFrom: c.req.query("dateFrom") as string | undefined,
    dateTo: c.req.query("dateTo") as string | undefined,
    search: (c.req.query("search") as string | undefined)?.trim(),
  };
}

/**
 * Single source of truth for the transaction list/aggregate WHERE filters, shared
 * by the list route and the grouped-by-date aggregate — their per-day counts must
 * stay in agreement (the day-drilldown invariant), which only holds if both build
 * the exact same filter set. The caller applies workspace_id + privacy + category
 * first (category differs: the list reads it multi-value, grouped-by-date pins
 * 'sale'); this appends the rest, self-indexing on params.length so it composes
 * after whatever the caller already pushed.
 */
export function applyTransactionListFilters(
  conditions: string[],
  params: unknown[],
  f: TransactionListFilters,
): void {
  const { subcategory, status, accountId, createdBy, dateFrom, dateTo, search } = f;

  if (subcategory && subcategory.trim() !== "") {
    const parts = subcategory.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 1) {
      params.push(parts[0]);
      conditions.push(`t.subcategory = $${params.length}`);
    } else if (parts.length > 1) {
      params.push(parts);
      conditions.push(`t.subcategory = ANY($${params.length})`);
    }
  }

  if (status && VALID_STATUSES.includes(status)) {
    params.push(status);
    conditions.push(`t.status = $${params.length}`);
  } else if (!status || status === "" || status === "active") {
    conditions.push(`t.status != 'voided'`);
  }

  if (accountId) {
    const aid = parseInt(accountId, 10);
    if (!isNaN(aid)) {
      params.push(aid);
      const p = params.length;
      conditions.push(
        `(t.source_account_id = $${p} OR t.destination_account_id = $${p} OR EXISTS (SELECT 1 FROM accounts.transaction_payments tp WHERE tp.transaction_id = t.id AND tp.financial_account_id = $${p}))`,
      );
    }
  }

  if (createdBy && createdBy.trim() !== "") {
    params.push(createdBy.trim());
    conditions.push(`t.created_by = $${params.length}`);
  }
  // Skip a malformed date rather than binding it — a non-ISO value casts-errors
  // against the `date` column and 500s instead of filtering.
  if (dateFrom && isValidIsoDate(dateFrom)) {
    params.push(dateFrom);
    conditions.push(`t.transaction_date >= $${params.length}`);
  }
  if (dateTo && isValidIsoDate(dateTo)) {
    params.push(dateTo);
    conditions.push(`t.transaction_date <= $${params.length}`);
  }
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    conditions.push(`(t.description ILIKE $${params.length} ESCAPE '\\' OR t.notes ILIKE $${params.length} ESCAPE '\\')`);
  }
}

// Privacy WHERE fragment shared by every list-style read. A private row is
// visible to its creator, to a user explicitly shared on it, to a role
// shared on it, or to an admin/superuser (who bypass entirely). Returns the
// SQL fragment + the next param index.
export function privacyClause(c: Context, params: unknown[], startIdx: number): string | null {
  if (isWorkspaceElevated(c)) return null;
  const userId = c.get("user")?.id ?? "";
  const frag = `(t.is_private = false OR t.created_by = $${startIdx} OR EXISTS (SELECT 1 FROM accounts.transaction_visibility tv WHERE tv.transaction_id = t.id AND tv.user_id = $${startIdx}) OR EXISTS (SELECT 1 FROM accounts.transaction_visibility_role tvr WHERE tvr.transaction_id = t.id AND tvr.role_code = $${startIdx + 1}))`;
  params.push(userId, c.get("wsRole") ?? "");
  return frag;
}
