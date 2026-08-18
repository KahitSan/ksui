type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0010_add_sales_invoice_sequences",
  async up({ client }: MigrationContext) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.invoice_settings (
        workspace_id INTEGER PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        next_number INTEGER NOT NULL DEFAULT 100,
        prefix TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE accounts.invoice_settings ENABLE ROW LEVEL SECURITY`);
    await client.query(`DROP POLICY IF EXISTS invoice_settings_isolation ON accounts.invoice_settings`);
    await client.query(`CREATE POLICY invoice_settings_isolation ON accounts.invoice_settings
      USING (auth.is_superuser() OR workspace_id = auth.workspace_id())
      WITH CHECK (auth.is_superuser() OR workspace_id = auth.workspace_id())`);
    await client.query(`GRANT SELECT, INSERT, UPDATE ON accounts.invoice_settings TO app_authenticated`);

    await client.query(`
      WITH numbered AS (
        SELECT id, workspace_id,
               ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY transaction_date, id) + 99 AS invoice_number
          FROM accounts.transactions
         WHERE category = 'sale'
           AND transaction_date >= DATE '2026-07-01'
           AND reference_number IS NULL
      )
      UPDATE accounts.transactions AS t
         SET reference_number = numbered.invoice_number::text, updated_at = NOW()
        FROM numbered
       WHERE t.id = numbered.id AND t.workspace_id = numbered.workspace_id
         AND t.reference_number IS NULL
    `);
    await client.query(`
      INSERT INTO accounts.invoice_settings (workspace_id, enabled, next_number, updated_at)
      SELECT workspace_id, TRUE,
             GREATEST(100, COALESCE(MAX(CASE WHEN reference_number ~ '^[0-9]+$'
               THEN reference_number::integer END) + 1, 100)), NOW()
        FROM accounts.transactions
       WHERE category = 'sale'
       GROUP BY workspace_id
      ON CONFLICT (workspace_id) DO UPDATE SET
        next_number = GREATEST(accounts.invoice_settings.next_number, EXCLUDED.next_number),
        updated_at = NOW()
    `);
  },
  async down() {
    throw new Error("Sales invoice backfill is irreversible");
  },
};

export default migration;
