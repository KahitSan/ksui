type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0024_add_financial_account_payment_preferences",
  async up({ client }: MigrationContext) {
    await client.query(`
      ALTER TABLE accounts.financial_accounts
        ADD COLUMN IF NOT EXISTS is_default_payment BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0
    `);

    await client.query(
      `ALTER TABLE accounts.financial_accounts DROP CONSTRAINT IF EXISTS financial_accounts_sort_order_nonnegative`
    );
    await client.query(`
      ALTER TABLE accounts.financial_accounts
        ADD CONSTRAINT financial_accounts_sort_order_nonnegative
        CHECK (sort_order >= 0) NOT VALID
    `);
    await client.query(
      `ALTER TABLE accounts.financial_accounts VALIDATE CONSTRAINT financial_accounts_sort_order_nonnegative`
    );

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_accounts_default_payment
      ON accounts.financial_accounts (workspace_id)
      WHERE is_default_payment = true
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_financial_accounts_payment_order
      ON accounts.financial_accounts (
        workspace_id,
        is_active,
        is_default_payment DESC,
        sort_order ASC,
        name ASC,
        id ASC
      )
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(
      `DROP INDEX IF EXISTS accounts.idx_financial_accounts_payment_order`
    );
    await client.query(
      `DROP INDEX IF EXISTS accounts.uq_financial_accounts_default_payment`
    );
    await client.query(
      `ALTER TABLE accounts.financial_accounts DROP CONSTRAINT IF EXISTS financial_accounts_sort_order_nonnegative`
    );
    await client.query(`
      ALTER TABLE accounts.financial_accounts
        DROP COLUMN IF EXISTS is_default_payment,
        DROP COLUMN IF EXISTS sort_order
    `);
  },
};

export default migration;
