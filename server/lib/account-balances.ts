import type { PluginDb } from "@kahitsan/plugin-sdk";

/**
 * Per-account computed balance, workspace-scoped. Mirrors the monolith's
 * financial-accounts ACCOUNT_BALANCE_SQL — split across two mutually-exclusive
 * halves so a sale is never counted twice:
 *   (a) Sales WITH recorded payment legs (accounts.transaction_payments) —
 *       each leg credits its financial_account_id its `amount`. Handles split
 *       payments cleanly.
 *   (b) Everything else routed via source_account_id / destination_account_id.
 *       Excludes sales already covered by (a) via NOT EXISTS.
 * Voided transactions are excluded on both sides. Returned as a plain object
 * keyed by account id.
 *
 * Perf note (assessed, not fixed here): the columns both CTEs filter/join on
 * are already indexed — transaction_payments(transaction_id) backs the
 * NOT EXISTS subplan, transaction_payments(financial_account_id, workspace_id)
 * backs leg_sums, and transactions(source_account_id, workspace_id, status) /
 * (destination_account_id, workspace_id, status) back legacy_sums' join — so
 * a new index would not change the plan. The residual cost is the
 * legacy_sums OR-join itself: workspace_id has poor selectivity for a
 * single-tenant-heavy deployment, so the planner ends up walking most of
 * accounts.transactions per read regardless of index choice. Only a
 * materialized/incrementally-maintained running balance removes that scan —
 * architectural, deferred.
 */
export async function computeAccountBalances(
  db: PluginDb,
  workspaceId: number,
  accountIds: number[]
): Promise<Record<number, { balance: number }>> {
  const out: Record<number, { balance: number }> = {};
  if (accountIds.length === 0) return out;
  for (const id of accountIds) out[id] = { balance: 0 };

  const r = await db.query<{ account_id: number; balance: string }>(
    `WITH ids AS (SELECT UNNEST($2::int[]) AS account_id),
          leg_sums AS (
            SELECT tp.financial_account_id AS account_id,
                   SUM(tp.amount) AS amt
              FROM accounts.transaction_payments tp
              JOIN accounts.transactions t ON t.id = tp.transaction_id
             WHERE tp.workspace_id = $1
               AND t.workspace_id = $1
               AND tp.financial_account_id = ANY($2::int[])
               AND t.status <> 'voided'
               AND t.category = 'sale'
             GROUP BY tp.financial_account_id
          ),
          legacy_sums AS (
            SELECT i.account_id,
                   SUM(CASE WHEN t.destination_account_id = i.account_id THEN t.amount ELSE 0 END)
                 - SUM(CASE WHEN t.source_account_id = i.account_id THEN t.amount ELSE 0 END) AS amt
              FROM ids i
              JOIN accounts.transactions t
                ON (t.source_account_id = i.account_id OR t.destination_account_id = i.account_id)
             WHERE t.workspace_id = $1
               AND t.status <> 'voided'
               AND (
                 t.category <> 'sale'
                 OR NOT EXISTS (
                   SELECT 1 FROM accounts.transaction_payments tp2
                    WHERE tp2.transaction_id = t.id
                 )
               )
             GROUP BY i.account_id
          )
     SELECT i.account_id,
            (COALESCE(ls.amt, 0) + COALESCE(lg.amt, 0))::text AS balance
       FROM ids i
       LEFT JOIN leg_sums ls ON ls.account_id = i.account_id
       LEFT JOIN legacy_sums lg ON lg.account_id = i.account_id`,
    [workspaceId, accountIds]
  );
  for (const row of r.rows) {
    out[row.account_id] = { balance: parseFloat(row.balance) || 0 };
  }
  return out;
}
