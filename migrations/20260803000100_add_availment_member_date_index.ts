type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "availment_0002_add_member_date_indexes",
  async up({ client }: MigrationContext) {
    await client.query(`
      ALTER TABLE accounts.availment_chain_members
        ADD COLUMN IF NOT EXISTS transaction_date date
    `);
    await client.query(`
      UPDATE accounts.availment_chain_members m
         SET transaction_date = g.transaction_date
        FROM accounts.availment_chain_groups g
       WHERE g.id = m.group_id
         AND m.transaction_date IS NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_members_ws_date_line
        ON accounts.availment_chain_members (workspace_id, transaction_date, line_item_id)
        INCLUDE (combined_end, group_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_members_ws_end_date_line
        ON accounts.availment_chain_members
          (workspace_id, combined_end, transaction_date, line_item_id)
        WHERE combined_end IS NOT NULL
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`DROP INDEX IF EXISTS accounts.idx_availment_members_ws_end_date_line`);
    await client.query(`DROP INDEX IF EXISTS accounts.idx_availment_members_ws_date_line`);
    await client.query(`ALTER TABLE accounts.availment_chain_members DROP COLUMN IF EXISTS transaction_date`);
  },
};

export default migration;
