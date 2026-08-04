type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "availment_0001_add_chain_projection",
  async up({ client }: MigrationContext) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.availment_chain_groups (
        id bigserial PRIMARY KEY,
        workspace_id integer NOT NULL,
        transaction_id integer NOT NULL,
        client_key integer NOT NULL,
        chain_id bigint NOT NULL,
        transaction_date date NOT NULL,
        combined_end timestamptz,
        chain_size integer NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, transaction_id, client_key, chain_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.availment_chain_members (
        workspace_id integer NOT NULL,
        line_item_id integer NOT NULL,
        group_id bigint REFERENCES accounts.availment_chain_groups(id),
        combined_end timestamptz,
        transaction_date date,
        line_status text,
        sort_end timestamptz,
        sort_bucket smallint,
        line_started_at timestamptz,
        line_ends_at timestamptz,
        PRIMARY KEY (workspace_id, line_item_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_chain_groups_ws_date
        ON accounts.availment_chain_groups (workspace_id, transaction_date, id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_chain_groups_ws_end_date
        ON accounts.availment_chain_groups (workspace_id, combined_end, transaction_date, id)
        WHERE combined_end IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_chain_members_ws_line
        ON accounts.availment_chain_members (workspace_id, line_item_id)
        INCLUDE (group_id, combined_end)
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
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_members_ws_ends_date_line
        ON accounts.availment_chain_members
          (workspace_id, ((line_ends_at AT TIME ZONE 'Asia/Manila')::date), line_item_id)
        WHERE combined_end IS NULL AND line_ends_at IS NOT NULL
    `);
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
    await client.query(`ALTER TABLE accounts.availment_chain_groups ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE accounts.availment_chain_members ENABLE ROW LEVEL SECURITY`);
    await client.query(`
      DROP POLICY IF EXISTS availment_chain_groups_workspace_isolation
        ON accounts.availment_chain_groups;
      CREATE POLICY availment_chain_groups_workspace_isolation
        ON accounts.availment_chain_groups
        USING (auth.is_superuser() OR workspace_id = auth.workspace_id())
        WITH CHECK (auth.is_superuser() OR workspace_id = auth.workspace_id())
    `);
    await client.query(`
      DROP POLICY IF EXISTS availment_chain_members_workspace_isolation
        ON accounts.availment_chain_members;
      CREATE POLICY availment_chain_members_workspace_isolation
        ON accounts.availment_chain_members
        USING (auth.is_superuser() OR workspace_id = auth.workspace_id())
        WITH CHECK (auth.is_superuser() OR workspace_id = auth.workspace_id())
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`DROP TABLE IF EXISTS accounts.availment_chain_members`);
    await client.query(`DROP TABLE IF EXISTS accounts.availment_chain_groups`);
  },
};

export default migration;
