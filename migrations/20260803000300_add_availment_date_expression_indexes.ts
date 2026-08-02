type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "availment_0004_add_date_expression_indexes",
  async up({ client }: MigrationContext) {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_members_ws_combined_manila_date
        ON accounts.availment_chain_members
          (workspace_id, ((combined_end AT TIME ZONE 'Asia/Manila')::date), line_item_id)
        WHERE combined_end IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tli_ws_ends_manila_date
        ON accounts.transaction_line_items
          (workspace_id, ((ends_at AT TIME ZONE 'Asia/Manila')::date), id)
        WHERE ends_at IS NOT NULL
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`DROP INDEX IF EXISTS accounts.idx_tli_ws_ends_manila_date`);
    await client.query(`DROP INDEX IF EXISTS accounts.idx_availment_members_ws_combined_manila_date`);
  },
};

export default migration;
