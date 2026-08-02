type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "availment_0005_add_sort_projection",
  async up({ client }: MigrationContext) {
    await client.query(`
      ALTER TABLE accounts.availment_chain_members
        ADD COLUMN IF NOT EXISTS line_status text,
        ADD COLUMN IF NOT EXISTS sort_end timestamptz,
        ADD COLUMN IF NOT EXISTS sort_bucket smallint
    `);
    await client.query(`
      UPDATE accounts.availment_chain_members m
         SET line_status = li.status,
             sort_end = li.ends_at,
             sort_bucket = CASE
               WHEN li.status = 'active' AND li.ends_at IS NOT NULL THEN 0
               ELSE 1
             END
        FROM accounts.transaction_line_items li
       WHERE li.id = m.line_item_id
         AND (m.line_status IS NULL OR m.sort_end IS DISTINCT FROM li.ends_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_members_ws_date_order
        ON accounts.availment_chain_members
          (workspace_id, transaction_date, sort_bucket, sort_end, line_item_id DESC)
        INCLUDE (combined_end, group_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_members_ws_end_date_order
        ON accounts.availment_chain_members
          (workspace_id, combined_end, transaction_date, sort_bucket, sort_end, line_item_id DESC)
        WHERE combined_end IS NOT NULL
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`DROP INDEX IF EXISTS accounts.idx_availment_members_ws_end_date_order`);
    await client.query(`DROP INDEX IF EXISTS accounts.idx_availment_members_ws_date_order`);
    await client.query(`
      ALTER TABLE accounts.availment_chain_members
        DROP COLUMN IF EXISTS sort_bucket,
        DROP COLUMN IF EXISTS sort_end,
        DROP COLUMN IF EXISTS line_status
    `);
  },
};

export default migration;
