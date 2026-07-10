// GET /api/transactions?sortBy=amount forces a Parallel Seq Scan of
// accounts.transactions (~800k rows) plus an external-merge disk sort — the
// list route's WHERE always carries workspace_id (+ status, explicit or the
// default `status != 'voided'`) but no existing index leads with amount, so
// the planner can't avoid materializing and sorting the whole filtered set.
// This composite index lets an amount-sorted, status-equality query walk the
// index in order and skip the sort/spill entirely. Plain CREATE INDEX (no
// CONCURRENTLY) — safe inside the migration runner's transaction, and this
// table sees far more reads than writes so a one-time ACCESS EXCLUSIVE build
// is an acceptable trade against a permanent write-time lock window.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0017_add_amount_sort_index",
  async up({ client }: MigrationContext) {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_ws_status_amount
      ON accounts.transactions (workspace_id, status, amount DESC, id DESC)
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`DROP INDEX IF EXISTS accounts.idx_transactions_ws_status_amount`);
  },
};

export default migration;
