// Adds a self-referencing link on accounts.transactions so a transfer
// row points at the auto-generated expense that captures its fee. Lets the
// edit form pre-fill the fee amount from the linked expense, and edits to
// the fee expense reflect back the moment the transfer is re-opened.
//
// Idempotent: ADD COLUMN IF NOT EXISTS, ADD CONSTRAINT is NOT VALID first
// (so existing rows don't abort), then VALIDATE. Nullable + ON DELETE SET
// NULL so deleting the fee expense doesn't cascade the transfer away.
type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0014_add_transfer_fee_link",
  async up({ client }: MigrationContext) {
    await client.query(`
      ALTER TABLE accounts.transactions
        ADD COLUMN IF NOT EXISTS transfer_fee_transaction_id INTEGER
    `);

    await client.query(
      `ALTER TABLE accounts.transactions DROP CONSTRAINT IF EXISTS transactions_transfer_fee_fk`,
    );
    await client.query(
      `ALTER TABLE accounts.transactions ADD CONSTRAINT transactions_transfer_fee_fk
         FOREIGN KEY (transfer_fee_transaction_id)
         REFERENCES accounts.transactions(id) ON DELETE SET NULL NOT VALID`,
    );
    await client.query(
      `ALTER TABLE accounts.transactions VALIDATE CONSTRAINT transactions_transfer_fee_fk`,
    );

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_transfer_fee
         ON accounts.transactions (transfer_fee_transaction_id)
        WHERE transfer_fee_transaction_id IS NOT NULL`,
    );
  },
};

export default migration;
