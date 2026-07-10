import type { PluginDb } from "@kahitsan/plugin-sdk";

/**
 * Per-account computed balance, workspace-scoped. Mirrors the monolith's
 * financial-accounts ACCOUNT_BALANCE_SQL — split across two mutually-exclusive
 * halves so a sale is never counted twice:
 *   (a) Sales WITH recorded payment legs (accounts.transaction_payments) —
 *       each leg credits its financial_account_id its `amount`. Handles split
 *       payments cleanly.
 *   (b) Everything else routed via source_account_id / destination_account_id.
 *       Excludes sales already covered by (a) — a transaction counts here iff
 *       its id is NOT in the paid_txn_ids set.
 * Voided transactions are excluded on both sides. Returned as a plain object
 * keyed by account id.
 *
 * Set-based rewrite (was: a correlated NOT EXISTS run once per legacy_sums
 * row, and an OR-join across source/destination that forced the planner to
 * materialize the whole workspace's transactions once per requested account
 * id and post-filter). paid_txn_ids computes the "already paid" set ONCE via
 * a single hash anti-join; legacy_sums UNION ALLs the destination leg and the
 * source leg separately so each half can hit its own single-column index
 * (idx_transactions_dest / idx_transactions_source) instead of an
 * unindexable OR condition. Reconciled byte-identical against the prior
 * correlated form across every account in a 300k-row synthetic fixture
 * (self-transfers, split legs, voided, unpaid sales all included) — see
 * tests/integration/account-balances.reconcile.test.ts.
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
          paid_txn_ids AS (
            SELECT DISTINCT transaction_id
              FROM accounts.transaction_payments
             WHERE workspace_id = $1
          ),
          legacy_sums AS (
            SELECT account_id, SUM(amt) AS amt
              FROM (
                SELECT t.destination_account_id AS account_id, t.amount AS amt
                  FROM accounts.transactions t
                  LEFT JOIN paid_txn_ids pd ON pd.transaction_id = t.id
                 WHERE t.workspace_id = $1
                   AND t.status <> 'voided'
                   AND t.destination_account_id = ANY($2::int[])
                   AND (t.category <> 'sale' OR pd.transaction_id IS NULL)
                UNION ALL
                SELECT t.source_account_id AS account_id, -t.amount AS amt
                  FROM accounts.transactions t
                  LEFT JOIN paid_txn_ids pd ON pd.transaction_id = t.id
                 WHERE t.workspace_id = $1
                   AND t.status <> 'voided'
                   AND t.source_account_id = ANY($2::int[])
                   AND (t.category <> 'sale' OR pd.transaction_id IS NULL)
              ) legs
             GROUP BY account_id
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
