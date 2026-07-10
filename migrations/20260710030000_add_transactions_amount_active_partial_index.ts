// idx_transactions_ws_status_amount (workspace_id, status, amount DESC, id
// DESC) only helps an EQUALITY status filter (?status=completed) — an
// inequality on the 2nd column (the route's default/most-common shape,
// status != 'voided') can't be served as an index range by that composite,
// so GET /api/transactions with no ?status (or ?status=active) still falls
// back to a Seq Scan + top-N sort at scale (measured ~5.4s cold at 800k
// rows for a workspace). A partial index matching the default filter
// directly — leading on workspace_id, sorted by amount DESC, id DESC,
// scoped to status <> 'voided' — lets the planner walk it in order and
// skip the sort/spill entirely for that shape while the composite index
// keeps serving the equality-status shape. Plain CREATE INDEX (no
// CONCURRENTLY) — safe inside the migration runner's transaction, same
// read-heavy trade-off as the sibling amount-sort index.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0018_add_amount_active_partial_index",
  async up({ client }: MigrationContext) {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_ws_amount_active
      ON accounts.transactions (workspace_id, amount DESC, id DESC)
      WHERE status <> 'voided'
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`DROP INDEX IF EXISTS accounts.idx_transactions_ws_amount_active`);
  },
};

export default migration;
