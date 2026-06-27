// Shared route context for the transactions router: the constants, the
// validation/escaping helpers, the user-name batch resolver, and the privacy
// WHERE fragment that every list-style read reuses. Extracted verbatim from
// routes.ts so the per-resource route modules can share one source of truth.
// privacyClause keeps the exact PrivacyClause signature lib/subscriptions.ts
// expects: (req, params, startIdx) => string | null.

import type { Context as HonoContext } from "hono";
import type { PluginDb } from "@kahitsan/plugin-sdk";

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

// Privacy WHERE fragment shared by every list-style read. A private row is
// visible to its creator, to a user explicitly shared on it, to a role
// shared on it, or to an admin/superuser (who bypass entirely). Returns the
// SQL fragment + the next param index.
export function privacyClause(req: Request, params: unknown[], startIdx: number): string | null {
  const isAdmin = c.get("wsRole") === "admin" || c.get("user")?.role === "superuser";
  if (isAdmin) return null;
  const userId = c.get("user")?.id ?? "";
  const frag = `(t.is_private = false OR t.created_by = $${startIdx} OR EXISTS (SELECT 1 FROM accounts.transaction_visibility tv WHERE tv.transaction_id = t.id AND tv.user_id = $${startIdx}) OR EXISTS (SELECT 1 FROM accounts.transaction_visibility_role tvr WHERE tvr.transaction_id = t.id AND tvr.role_code = $${startIdx + 1}))`;
  params.push(userId, c.get("wsRole") ?? "");
  return frag;
}
