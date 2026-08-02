type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "availment_0003_allow_non_time_members",
  async up({ client }: MigrationContext) {
    // Retail/add-on lines inherit a subgroup end but have no own chain.
    await client.query(`
      ALTER TABLE accounts.availment_chain_members
        ALTER COLUMN group_id DROP NOT NULL
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM accounts.availment_chain_members
          WHERE group_id IS NULL
        ) THEN
          RAISE EXCEPTION 'cannot restore NOT NULL while non-time members exist';
        END IF;
        ALTER TABLE accounts.availment_chain_members
          ALTER COLUMN group_id SET NOT NULL;
      END $$
    `);
  },
};

export default migration;
