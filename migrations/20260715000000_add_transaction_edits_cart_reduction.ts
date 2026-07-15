// apply-cart-edit needs a per-call idempotency key (retried Saves must replay,
// never double-void) plus a stored response payload for that replay, and two
// new transaction_edits `kind` values for the reduction/line-void audit rows.
// Both new columns are nullable — no backfill needed, existing void/unvoid/etc.
// rows are untouched. Follows the same DROP CONSTRAINT IF EXISTS → ADD ... NOT
// VALID → VALIDATE CONSTRAINT pattern already used on this table so it's
// idempotent and re-runnable. The allowlist carries forward 'forfeit'
// (added by 20260707000000_add_transaction_forfeit.ts) — narrowing it back
// to the original 5 values would reject every existing forfeit-audit row.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0021_add_transaction_edits_cart_reduction",
  async up({ client }: MigrationContext) {
    await client.query(
      `ALTER TABLE accounts.transaction_edits ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits ADD COLUMN IF NOT EXISTS payload JSONB`,
    );
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS transaction_edits_idem_key_uniq
         ON accounts.transaction_edits (transaction_id, idempotency_key)
         WHERE idempotency_key IS NOT NULL`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits DROP CONSTRAINT IF EXISTS transaction_edits_kind_check`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits ADD CONSTRAINT transaction_edits_kind_check CHECK (kind = ANY (ARRAY['edit','counter_edit','sales_edit','void','unvoid','forfeit','cart_reduction','line_item_void'])) NOT VALID`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits VALIDATE CONSTRAINT transaction_edits_kind_check`,
    );
  },
  async down({ client }: MigrationContext) {
    await client.query(`DROP INDEX IF EXISTS accounts.transaction_edits_idem_key_uniq`);
    await client.query(
      `ALTER TABLE accounts.transaction_edits DROP CONSTRAINT IF EXISTS transaction_edits_kind_check`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits ADD CONSTRAINT transaction_edits_kind_check CHECK (kind = ANY (ARRAY['edit','counter_edit','sales_edit','void','unvoid','forfeit'])) NOT VALID`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_edits VALIDATE CONSTRAINT transaction_edits_kind_check`,
    );
    await client.query(`ALTER TABLE accounts.transaction_edits DROP COLUMN IF EXISTS payload`);
    await client.query(`ALTER TABLE accounts.transaction_edits DROP COLUMN IF EXISTS idempotency_key`);
  },
};

export default migration;
