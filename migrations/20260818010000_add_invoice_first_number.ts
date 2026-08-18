type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0011_add_invoice_first_number",
  async up({ client }: MigrationContext) {
    await client.query(`
      ALTER TABLE accounts.invoice_settings
        ADD COLUMN IF NOT EXISTS first_number INTEGER NOT NULL DEFAULT 100
    `);
    await client.query(`
      UPDATE accounts.invoice_settings AS s
         SET first_number = COALESCE((
           SELECT MIN(NULLIF(t.reference_number, '')::integer)
             FROM accounts.transactions t
            WHERE t.workspace_id = s.workspace_id
              AND t.category = 'sale'
              AND t.transaction_date >= DATE '2026-07-01'
              AND t.reference_number ~ '^[0-9]+$'
         ), s.first_number)
    `);
  },
  async down() {
    throw new Error("Invoice starting numbers are retained intentionally");
  },
};

export default migration;
