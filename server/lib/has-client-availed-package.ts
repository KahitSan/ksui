import type { PluginDb } from "@kahitsan/plugin-sdk";

/** One eligibility check the caller wants answered — `packageIds` is the
 *  full set of era ids for one lineage (resolved by the caller, since
 *  packages owns lineage_slug, not this plugin). */
export interface AvailedPackageCheck {
  key: string;
  packageIds: number[];
  beforeDate: string;
}

/** Parse + validate the raw RPC args into typed checks. Drops any entry
 *  missing a required field rather than throwing, so one malformed check
 *  doesn't fail the whole batch. */
export function parseAvailedPackageChecks(raw: unknown): AvailedPackageCheck[] {
  if (!Array.isArray(raw)) return [];
  const out: AvailedPackageCheck[] = [];
  for (const entry of raw) {
    const c = (entry ?? {}) as { key?: unknown; packageIds?: unknown; beforeDate?: unknown };
    const key = typeof c.key === "string" && c.key.length > 0 ? c.key : null;
    const beforeDate =
      typeof c.beforeDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.beforeDate)
        ? c.beforeDate
        : null;
    const packageIds = Array.isArray(c.packageIds)
      ? c.packageIds
          .map((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
          .filter((n) => Number.isInteger(n))
      : [];
    if (key && beforeDate && packageIds.length > 0) out.push({ key, packageIds, beforeDate });
  }
  return out;
}

/**
 * Answers, per check, whether `clientId` has an active/completed line item
 * against one of `packageIds` dated before `beforeDate` — the
 * `client_availed_package_before` eligibility condition packages evaluates
 * per catalog row. Workspace-scoped; runs one query per check (batch size is
 * bounded by the catalog's distinct conditional rows, not customer volume).
 */
export async function hasClientAvailedPackage(
  db: PluginDb,
  workspaceId: number,
  clientId: number,
  checks: AvailedPackageCheck[],
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const check of checks) {
    const r = await db.query<{ availed: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM accounts.transaction_line_items li
           JOIN accounts.transactions t
             ON t.id = li.transaction_id AND t.workspace_id = li.workspace_id
          WHERE li.workspace_id = $1
            AND COALESCE(li.client_id, t.client_id) = $2
            AND li.status IN ('active', 'completed')
            AND t.transaction_date < $3::date
            AND li.package_id = ANY($4::int[])
       ) AS availed`,
      [workspaceId, clientId, check.beforeDate, check.packageIds],
    );
    out[check.key] = r.rows[0]?.availed === true;
  }
  return out;
}
