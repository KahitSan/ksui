type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0012_correct_invoice_starting_number",
  async up({ client }: MigrationContext) {
    await client.query(`
      UPDATE accounts.invoice_settings AS s
         SET first_number = (
           SELECT NULLIF(t.reference_number, '')::integer
             FROM accounts.transactions t
            WHERE t.workspace_id = s.workspace_id
              AND t.category = 'sale'
              AND t.transaction_date >= DATE '2026-07-01'
              AND t.reference_number ~ '^[0-9]+$'
            ORDER BY t.transaction_date ASC, t.id ASC
            LIMIT 1
         ),
             updated_at = NOW()
       WHERE EXISTS (
           SELECT 1
             FROM accounts.transactions t
            WHERE t.workspace_id = s.workspace_id
              AND t.category = 'sale'
              AND t.transaction_date >= DATE '2026-07-01'
              AND t.reference_number ~ '^[0-9]+$'
       )
    `);
  },
  async down() {
    throw new Error("Invoice starting number correction is retained intentionally");
  },
};

export default migration;
