type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "availment_0010_deduplicate_transaction_dirty_keys",
  async up({ client }: MigrationContext) {
    await client.query(`
      CREATE OR REPLACE FUNCTION accounts.mark_availment_transaction_date_dirty()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = accounts, pg_catalog
      AS $fn$
      BEGIN
        IF NEW.transaction_date IS DISTINCT FROM OLD.transaction_date THEN
          INSERT INTO accounts.availment_projection_dirty (workspace_id, transaction_id, client_key)
          SELECT DISTINCT li.workspace_id, li.transaction_id, COALESCE(li.client_id, -1)
            FROM accounts.transaction_line_items li
           WHERE li.workspace_id = NEW.workspace_id
             AND li.transaction_id = NEW.id
          ON CONFLICT (workspace_id, transaction_id, client_key) DO UPDATE SET dirty_at = now();
        END IF;
        RETURN NEW;
      END
      $fn$
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`DROP FUNCTION IF EXISTS accounts.mark_availment_transaction_date_dirty()`);
  },
};

export default migration;
