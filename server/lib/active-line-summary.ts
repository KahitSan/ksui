// Shared active-line summary derivation — the list route's LATERAL,
// apply-cart-edit's post-mutation description regenerate, and the detail
// route's title all need the SAME "N× label, N× label" rollup of a
// transaction's currently-active (non-voided) lines, so the label logic
// lives here once instead of drifting into hand-maintained copies.
//
// The label logic resolves each line's package name and prepends it to the
// line's stored `description` — the SAME per-line resolution
// TransactionDetail.tsx's "Packages availed" pane uses (package_name from
// the packages RPC), so the row title and the pane agree BY CONSTRUCTION
// instead of drifting when a line's stored description predates the
// description-format fix (bare "4 Hours" instead of "Package — 4 Hours").
//
// Package names live in a separate plugin's schema, reachable only over the
// kernel RPC (see peers.ts) — never a cross-schema SQL join — so this SQL
// returns the raw active lines (id/quantity/description/package_id) for a
// caller to resolve + label in JS, not an already-aggregated string.
import type { PoolClient } from "pg";
import { findPackagesByIds, type IdentityHeader } from "./peers.js";

// Referenced from a LATERAL whose outer query binds t.id / t.workspace_id —
// keep the inner SELECT in exact sync with deriveActiveLineSummary's own
// query below (same 3-line cap, same id-ascending order).
export const ACTIVE_LINE_ROWS_SQL = `
  SELECT COALESCE(
    json_agg(
      json_build_object('id', sub.id, 'quantity', sub.quantity, 'description', sub.description, 'package_id', sub.package_id)
      ORDER BY sub.id ASC
    ),
    '[]'::json
  ) AS lines
    FROM (
      SELECT li.id, li.quantity, li.description, li.package_id
        FROM accounts.transaction_line_items li
       WHERE li.transaction_id = t.id AND li.workspace_id = t.workspace_id
         AND li.status <> 'voided'
       ORDER BY li.id ASC
       LIMIT 3
    ) sub`;

export interface ActiveLineRow {
  id: number;
  quantity: number;
  description: string;
  package_id: number | null;
}

export interface ActiveLineForLabel {
  quantity: number | string;
  description: string;
  package_name: string | null;
}

/**
 * Prepends the resolved package name to a line's label, unless the
 * description already embeds it — charge-format descriptions built by
 * build-charge-payload.ts / transactions-cart-edit.ts already read
 * "Package — Variant", and re-prepending there would double the name.
 */
export function formatActiveLineLabel(description: string, packageName: string | null): string {
  if (packageName == null || description.startsWith(`${packageName} — `)) return description;
  return `${packageName} — ${description}`;
}

/** Joins active lines into the "N× label, N× label" summary shown as the
 *  row/detail title, each line labeled via formatActiveLineLabel. */
export function summarizeActiveLines(lines: ActiveLineForLabel[]): string {
  return lines
    .map((l) => `${l.quantity}× ${formatActiveLineLabel(l.description, l.package_name)}`)
    .join(", ");
}

/**
 * Derives the "N× label, N× label" summary from a transaction's currently-
 * active (non-voided) line items, resolving each line's package name over
 * RPC so the summary matches the detail pane's per-line resolution. Matches
 * the list route's LATERAL derivation exactly (same 3-line cap, same
 * id-ascending order). Returns null when the transaction has no active
 * lines — callers keep the existing stored description in that case rather
 * than overwrite it.
 */
export async function deriveActiveLineSummary(
  client: PoolClient,
  transactionId: number,
  workspaceId: number,
  identityHeader: IdentityHeader,
): Promise<string | null> {
  const res = await client.query<ActiveLineRow>(
    `SELECT li.id, li.quantity, li.description, li.package_id
       FROM accounts.transaction_line_items li
      WHERE li.transaction_id = $1 AND li.workspace_id = $2
        AND li.status <> 'voided'
      ORDER BY li.id ASC
      LIMIT 3`,
    [transactionId, workspaceId],
  );
  if (res.rows.length === 0) return null;

  const packageIds = [
    ...new Set(res.rows.map((r) => r.package_id).filter((id): id is number => id != null)),
  ];
  const packages = packageIds.length > 0 ? await findPackagesByIds(packageIds, identityHeader) : [];
  const packageNameById = new Map<number, string>((packages ?? []).map((p) => [p.id, p.name]));

  return summarizeActiveLines(
    res.rows.map((r) => ({
      quantity: r.quantity,
      description: r.description,
      package_name: r.package_id != null ? (packageNameById.get(r.package_id) ?? null) : null,
    })),
  );
}
