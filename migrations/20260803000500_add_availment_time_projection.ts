type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "availment_0006_add_time_projection",
  async up({ client }: MigrationContext) {
    await client.query(`
      ALTER TABLE accounts.availment_chain_members
        ADD COLUMN IF NOT EXISTS line_started_at timestamptz,
        ADD COLUMN IF NOT EXISTS line_ends_at timestamptz
    `);
    await client.query(`
      UPDATE accounts.availment_chain_members m
         SET line_started_at = li.started_at,
             line_ends_at = li.ends_at
        FROM accounts.transaction_line_items li
       WHERE li.id = m.line_item_id
         AND (m.line_started_at IS DISTINCT FROM li.started_at
           OR m.line_ends_at IS DISTINCT FROM li.ends_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_members_ws_ends_date_line
        ON accounts.availment_chain_members
          (workspace_id, ((line_ends_at AT TIME ZONE 'Asia/Manila')::date), line_item_id)
        WHERE combined_end IS NULL AND line_ends_at IS NOT NULL
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`DROP INDEX IF EXISTS accounts.idx_availment_members_ws_ends_date_line`);
    await client.query(`
      ALTER TABLE accounts.availment_chain_members
        DROP COLUMN IF EXISTS line_ends_at,
        DROP COLUMN IF EXISTS line_started_at
    `);
  },
};

export default migration;
