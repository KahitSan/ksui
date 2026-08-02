type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "availment_0007_add_range_order_indexes",
  async up({ client }: MigrationContext) {
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_members_ws_date_active_order
        ON accounts.availment_chain_members
          (workspace_id, transaction_date, line_item_id DESC)
        WHERE line_status != 'voided'
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_members_ws_end_active_order
        ON accounts.availment_chain_members
          (workspace_id, combined_end, line_item_id DESC)
        WHERE combined_end IS NOT NULL AND line_status != 'voided'
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_members_ws_started_active_order
        ON accounts.availment_chain_members
          (workspace_id, line_started_at, line_item_id DESC)
        WHERE line_started_at IS NOT NULL AND line_status != 'voided'
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_members_ws_ends_active_order
        ON accounts.availment_chain_members
          (workspace_id, line_ends_at, line_item_id DESC)
        WHERE combined_end IS NULL
          AND line_ends_at IS NOT NULL
          AND line_status != 'voided'
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`DROP INDEX IF EXISTS accounts.idx_availment_members_ws_started_active_order`);
    await client.query(`DROP INDEX IF EXISTS accounts.idx_availment_members_ws_ends_active_order`);
    await client.query(`DROP INDEX IF EXISTS accounts.idx_availment_members_ws_end_active_order`);
    await client.query(`DROP INDEX IF EXISTS accounts.idx_availment_members_ws_date_active_order`);
  },
};

export default migration;
