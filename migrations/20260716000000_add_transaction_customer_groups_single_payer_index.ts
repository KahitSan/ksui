// Prod already carries this exact index (name/columns/WHERE match live prod
// verbatim) but no migration ever created it, so a fresh environment built
// from migrations alone lacks the constraint transactions-cart-edit.ts's
// flip-UPDATE depends on. A DB missing the index (unlike prod) could already
// hold duplicate is_payer=TRUE rows per transaction from before this
// constraint existed, so CREATE UNIQUE INDEX would abort on that data —
// dedupe first, keeping the earliest payer flag per transaction and
// clearing the rest, then create the index. Plain CREATE INDEX (no
// CONCURRENTLY) matches the sibling index migrations in this file — the
// runner executes each migration's up() inside one transaction, and
// CONCURRENTLY can't run inside a transaction block.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0022_add_transaction_customer_groups_single_payer_index",
  async up({ client }: MigrationContext) {
    await client.query(`
      UPDATE accounts.transaction_customer_groups tcg
      SET is_payer = false
      WHERE is_payer = true
        AND id NOT IN (
          SELECT DISTINCT ON (transaction_id) id
          FROM accounts.transaction_customer_groups
          WHERE is_payer = true
          ORDER BY transaction_id, created_at ASC, id ASC
        )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_customer_groups_single_payer
      ON accounts.transaction_customer_groups (transaction_id)
      WHERE is_payer = true
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(
      `DROP INDEX IF EXISTS accounts.idx_transaction_customer_groups_single_payer`,
    );
  },
};

export default migration;
