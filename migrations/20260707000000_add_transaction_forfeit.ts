// Adds forfeit support to accounts.transactions — writing off a sale's
// remaining balance (no-show / too-late-to-refund) while leaving the
// already-collected accounts.transaction_payments rows untouched.
//
// Idempotent: ADD COLUMN IF NOT EXISTS, DROP+ADD NOT VALID/VALIDATE for the
// extended kind CHECK. Safe on a populated table — every new column defaults
// to NULL (not-forfeited) so existing rows are unaffected.
type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0013_add_forfeit",
  async up({ client }: MigrationContext) {
    await client.query(`
      ALTER TABLE accounts.transactions
        ADD COLUMN IF NOT EXISTS forfeited_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS forfeited_amount NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS forfeited_by TEXT,
        ADD COLUMN IF NOT EXISTS forfeited_reason TEXT
    `);

    await client.query(
      `ALTER TABLE accounts.transactions DROP CONSTRAINT IF EXISTS transactions_forfeited_amount_check`,
    );
    await client.query(
      `ALTER TABLE accounts.transactions ADD CONSTRAINT transactions_forfeited_amount_check
         CHECK (forfeited_amount IS NULL OR forfeited_amount > 0) NOT VALID`,
    );
    await client.query(
      `ALTER TABLE accounts.transactions VALIDATE CONSTRAINT transactions_forfeited_amount_check`,
    );

    // 'forfeit' joins the existing kind vocabulary for the append-only audit trail.
    await client.query(
      `ALTER TABLE accounts.transaction_edits DROP CONSTRAINT IF EXISTS transaction_edits_kind_check`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits ADD CONSTRAINT transaction_edits_kind_check
         CHECK (kind = ANY (ARRAY['edit','counter_edit','sales_edit','void','unvoid','forfeit'])) NOT VALID`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits VALIDATE CONSTRAINT transaction_edits_kind_check`,
    );

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_transactions_forfeited
         ON accounts.transactions (workspace_id)
        WHERE forfeited_at IS NOT NULL`,
    );
  },
};

export default migration;
