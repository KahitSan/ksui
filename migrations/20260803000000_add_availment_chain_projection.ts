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
        group_id bigint NOT NULL REFERENCES accounts.availment_chain_groups(id),
        combined_end timestamptz,
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
