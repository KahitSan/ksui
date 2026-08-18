type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0013_set_invoice_starting_number_101",
  async up({ client }: MigrationContext) {
    await client.query(`
      UPDATE accounts.invoice_settings
         SET first_number = 101,
             updated_at = NOW()
       WHERE first_number = 100
         AND next_number > 101
    `);
  },
  async down() {
    throw new Error("Invoice starting number correction is retained intentionally");
  },
};

export default migration;
