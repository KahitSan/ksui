// Adopts the `accounts.financial_accounts` table into the transactions plugin
// as part of the financial-accounts fold-in (the standalone plugin is retired
// in the same rollout). On prod the table already exists with real rows, so
// every statement is IF [NOT] EXISTS / DROP-then-CREATE / NOT VALID+VALIDATE
// and touches no data.
//
// The `accounts` schema is already this plugin's — transactions has always
// declared `schemas:["accounts"]`. Adoption here just re-owns the CREATE side
// of financial_accounts in this plugin's migration tracker so future column /
// constraint / index changes ship from here. Runs under plugin='transactions'
// in the shared (plugin,name) tracker.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0013_adopt_financial_accounts",
  async up({ client }: MigrationContext) {
    await client.query(`CREATE SCHEMA IF NOT EXISTS accounts`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.financial_accounts (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE accounts.financial_accounts
        ADD COLUMN IF NOT EXISTS icon TEXT,
        ADD COLUMN IF NOT EXISTS color TEXT,
        ADD COLUMN IF NOT EXISTS s3_link TEXT,
        ADD COLUMN IF NOT EXISTS asset_id INTEGER
    `);

    await client.query(
      `ALTER TABLE accounts.financial_accounts DROP CONSTRAINT IF EXISTS financial_accounts_type_check`
    );
    await client.query(`
      ALTER TABLE accounts.financial_accounts
        ADD CONSTRAINT financial_accounts_type_check
        CHECK (type IN ('bank', 'e_wallet', 'cash', 'external', 'capital')) NOT VALID
    `);
    await client.query(
      `ALTER TABLE accounts.financial_accounts VALIDATE CONSTRAINT financial_accounts_type_check`
    );

    await client.query(
      `ALTER TABLE accounts.financial_accounts DROP CONSTRAINT IF EXISTS financial_accounts_color_check`
    );
    await client.query(`
      ALTER TABLE accounts.financial_accounts
        ADD CONSTRAINT financial_accounts_color_check
        CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$') NOT VALID
    `);
    await client.query(
      `ALTER TABLE accounts.financial_accounts VALIDATE CONSTRAINT financial_accounts_color_check`
    );

    await client.query(
      `ALTER TABLE accounts.financial_accounts DROP CONSTRAINT IF EXISTS financial_accounts_s3_link_format_check`
    );
    await client.query(`
      ALTER TABLE accounts.financial_accounts
        ADD CONSTRAINT financial_accounts_s3_link_format_check
        CHECK (s3_link IS NULL OR s3_link ~ '^https?://')
        NOT VALID
    `);
    await client.query(
      `ALTER TABLE accounts.financial_accounts VALIDATE CONSTRAINT financial_accounts_s3_link_format_check`
    );

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_accounts_org_active
      ON accounts.financial_accounts (workspace_id, is_active)
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_accounts_org_name
      ON accounts.financial_accounts (workspace_id, LOWER(name))
    `);

    await client.query(`ALTER TABLE accounts.financial_accounts ENABLE ROW LEVEL SECURITY`);
    await client.query(
      `DROP POLICY IF EXISTS financial_accounts_org_isolation ON accounts.financial_accounts`
    );
    await client.query(`CREATE POLICY financial_accounts_org_isolation ON accounts.financial_accounts
      USING (auth.is_superuser() OR workspace_id = auth.workspace_id())
      WITH CHECK (auth.is_superuser() OR workspace_id = auth.workspace_id())`);
  },
  // No down(): dropping accounts.financial_accounts would destroy real prod
  // rows. Adoption is additive.
  async down(_ctx: MigrationContext) {},
};

export default migration;
