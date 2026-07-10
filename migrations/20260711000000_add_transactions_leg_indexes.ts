// idx_transactions_source / idx_transactions_dest already exist on prod (created
// pre-fork, in the monolith's own kernel migrations) but were never ported into
// this plugin's migration set — a fresh finance-plugin-only deploy (no monolith
// history) would silently lack them. computeAccountBalances' legacy_sums rewrite
// (server/lib/account-balances.ts) depends on both for its UNION ALL legs to hit
// a Bitmap Index Scan instead of a full table scan; ships alongside that rewrite
// so the perf win is guaranteed on any deploy, not just prod's current state.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0020_add_leg_indexes",
  async up({ client }: MigrationContext) {
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_source ON accounts.transactions (source_account_id)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_dest ON accounts.transactions (destination_account_id)`,
    );
  },
  async down({ client }: MigrationContext) {
    await client.query(`DROP INDEX IF EXISTS accounts.idx_transactions_source`);
    await client.query(`DROP INDEX IF EXISTS accounts.idx_transactions_dest`);
  },
};

export default migration;
