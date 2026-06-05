type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0004_add_s3_link",
  async up({ client }: MigrationContext) {
    await client.query(
      "ALTER TABLE accounts.transaction_attachments ADD COLUMN IF NOT EXISTS s3_link text",
    );
  },
};

export default migration;
