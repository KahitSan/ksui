type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "availment_0009_add_incremental_refresh",
  async up({ client }: MigrationContext) {
    await client.query(`
      ALTER TABLE accounts.availment_chain_members
        ADD COLUMN IF NOT EXISTS transaction_id integer,
        ADD COLUMN IF NOT EXISTS client_key integer
    `);
    await client.query(`
      UPDATE accounts.availment_chain_members m
         SET transaction_id = li.transaction_id,
             client_key = COALESCE(li.client_id, -1)
        FROM accounts.transaction_line_items li
       WHERE li.id = m.line_item_id
         AND li.workspace_id = m.workspace_id
         AND (m.transaction_id IS NULL OR m.client_key IS NULL)
    `);
    await client.query(`
      ALTER TABLE accounts.availment_chain_members
        ALTER COLUMN transaction_id SET NOT NULL,
        ALTER COLUMN client_key SET NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_members_ws_subgroup_line
        ON accounts.availment_chain_members
          (workspace_id, transaction_id, client_key, line_item_id)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.availment_projection_dirty (
        workspace_id integer NOT NULL,
        transaction_id integer NOT NULL,
        client_key integer NOT NULL,
        dirty_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, transaction_id, client_key)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_availment_projection_dirty_at
        ON accounts.availment_projection_dirty (dirty_at, workspace_id)
    `);
    await client.query(`ALTER TABLE accounts.availment_projection_dirty ENABLE ROW LEVEL SECURITY`);
    await client.query(`
      DROP POLICY IF EXISTS availment_projection_dirty_workspace_isolation
        ON accounts.availment_projection_dirty;
      CREATE POLICY availment_projection_dirty_workspace_isolation
        ON accounts.availment_projection_dirty
        USING (auth.is_superuser() OR workspace_id = auth.workspace_id())
        WITH CHECK (auth.is_superuser() OR workspace_id = auth.workspace_id())
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION accounts.mark_availment_projection_dirty()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = accounts, pg_catalog
      AS $fn$
      BEGIN
        IF TG_OP <> 'INSERT' THEN
          INSERT INTO accounts.availment_projection_dirty
            (workspace_id, transaction_id, client_key, dirty_at)
          VALUES (OLD.workspace_id, OLD.transaction_id, COALESCE(OLD.client_id, -1), now())
          ON CONFLICT (workspace_id, transaction_id, client_key)
          DO UPDATE SET dirty_at = EXCLUDED.dirty_at;
        END IF;
        IF TG_OP <> 'DELETE' THEN
          INSERT INTO accounts.availment_projection_dirty
            (workspace_id, transaction_id, client_key, dirty_at)
          VALUES (NEW.workspace_id, NEW.transaction_id, COALESCE(NEW.client_id, -1), now())
          ON CONFLICT (workspace_id, transaction_id, client_key)
          DO UPDATE SET dirty_at = EXCLUDED.dirty_at;
        END IF;
        RETURN COALESCE(NEW, OLD);
      END
      $fn$
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS trg_availment_projection_dirty
        ON accounts.transaction_line_items;
      CREATE TRIGGER trg_availment_projection_dirty
        AFTER INSERT OR DELETE OR UPDATE OF workspace_id, transaction_id, client_id,
          started_at, ends_at, duration_value, duration_unit, quantity, status
        ON accounts.transaction_line_items
        FOR EACH ROW EXECUTE FUNCTION accounts.mark_availment_projection_dirty()
    `);
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
          SELECT li.workspace_id, li.transaction_id, COALESCE(li.client_id, -1)
            FROM accounts.transaction_line_items li
           WHERE li.workspace_id = NEW.workspace_id
             AND li.transaction_id = NEW.id
          ON CONFLICT (workspace_id, transaction_id, client_key) DO UPDATE SET dirty_at = now();
        END IF;
        RETURN NEW;
      END
      $fn$
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS trg_availment_transaction_date_dirty
        ON accounts.transactions;
      CREATE TRIGGER trg_availment_transaction_date_dirty
        AFTER UPDATE OF transaction_date ON accounts.transactions
        FOR EACH ROW EXECUTE FUNCTION accounts.mark_availment_transaction_date_dirty()
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION accounts.refresh_availment_projection_key(
        p_workspace_id integer,
        p_transaction_id integer,
        p_client_key integer
      ) RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = accounts, pg_catalog
      AS $fn$
      BEGIN
        DELETE FROM accounts.availment_chain_members
         WHERE workspace_id = p_workspace_id
           AND transaction_id = p_transaction_id
           AND client_key = p_client_key;
        DELETE FROM accounts.availment_chain_groups
         WHERE workspace_id = p_workspace_id
           AND transaction_id = p_transaction_id
           AND client_key = p_client_key;

        DROP TABLE IF EXISTS pg_temp._availment_refresh_metrics;
        CREATE TEMP TABLE _availment_refresh_metrics ON COMMIT DROP AS
        WITH availment_chain_flags AS (
          SELECT
            sib.id,
            sib.transaction_id,
            sib.workspace_id,
            COALESCE(sib.client_id, -1) AS client_key,
            sib.started_at,
            sib.ends_at,
            sib.duration_value,
            sib.duration_unit,
            sib.quantity,
            CASE
              WHEN COUNT(*) OVER w = 0 THEN 1
              WHEN MAX(sib.ends_at) OVER w IS NULL THEN 0
              WHEN sib.started_at > MAX(sib.ends_at) OVER w THEN 1
              ELSE 0
            END AS chain_break
          FROM accounts.transaction_line_items sib
          WHERE sib.workspace_id = p_workspace_id
            AND sib.transaction_id = p_transaction_id
            AND COALESCE(sib.client_id, -1) = p_client_key
            AND sib.status != 'voided'
            AND sib.started_at IS NOT NULL
            AND sib.duration_value IS NOT NULL
            AND sib.duration_unit IS NOT NULL
          WINDOW w AS (
            PARTITION BY sib.transaction_id, sib.workspace_id, COALESCE(sib.client_id, -1)
            ORDER BY sib.started_at, sib.ends_at, sib.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          )
        ), availment_chain_ids AS (
          SELECT f.*,
                 SUM(chain_break) OVER (
                   PARTITION BY transaction_id, workspace_id, client_key
                   ORDER BY started_at, ends_at, id
                   ROWS UNBOUNDED PRECEDING
                 ) AS chain_id
          FROM availment_chain_flags f
        ), availment_chain_metrics AS (
          SELECT a.*,
                 MIN(started_at) OVER chain_window
                   + COALESCE(SUM(CASE WHEN duration_unit = 'hour'
                                      THEN duration_value * COALESCE(quantity, 1) END) OVER chain_window, 0) * INTERVAL '1 hour'
                   + COALESCE(SUM(CASE WHEN duration_unit = 'day'
                                      THEN duration_value * COALESCE(quantity, 1) END) OVER chain_window, 0) * INTERVAL '1 day'
                   + COALESCE(SUM(CASE WHEN duration_unit = 'month'
                                      THEN duration_value * COALESCE(quantity, 1) END) OVER chain_window, 0) * INTERVAL '1 month'
                   AS combined_end,
                 COUNT(*) OVER chain_window AS chain_size
          FROM availment_chain_ids a
          WINDOW chain_window AS (
            PARTITION BY transaction_id, workspace_id, client_key, chain_id
          )
        )
        SELECT m.id, m.transaction_id, m.workspace_id, m.client_key, m.chain_id,
               m.combined_end, m.chain_size, t.transaction_date,
               li.status AS line_status, li.ends_at AS sort_end,
               CASE WHEN li.status = 'active' AND li.ends_at IS NOT NULL THEN 0 ELSE 1 END::smallint AS sort_bucket,
               li.started_at AS line_started_at, li.ends_at AS line_ends_at
          FROM availment_chain_metrics m
          JOIN accounts.transaction_line_items li
            ON li.id = m.id AND li.workspace_id = m.workspace_id
          JOIN accounts.transactions t
            ON t.id = m.transaction_id AND t.workspace_id = m.workspace_id;

        INSERT INTO accounts.availment_chain_groups
          (workspace_id, transaction_id, client_key, chain_id, transaction_date, combined_end, chain_size)
        SELECT DISTINCT workspace_id, transaction_id, client_key, chain_id,
                        transaction_date, combined_end, chain_size
          FROM _availment_refresh_metrics
         WHERE chain_size >= 2;

        INSERT INTO accounts.availment_chain_members
          (workspace_id, line_item_id, transaction_id, client_key, group_id,
           combined_end, transaction_date, line_status, sort_end, sort_bucket,
           line_started_at, line_ends_at)
        SELECT m.workspace_id, m.id, m.transaction_id, m.client_key, g.id,
               m.combined_end, m.transaction_date, m.line_status, m.sort_end,
               m.sort_bucket, m.line_started_at, m.line_ends_at
          FROM _availment_refresh_metrics m
          JOIN accounts.availment_chain_groups g
            ON g.workspace_id = m.workspace_id
           AND g.transaction_id = m.transaction_id
           AND g.client_key = m.client_key
           AND g.chain_id = m.chain_id
         WHERE m.chain_size >= 2;

        WITH latest_subgroup AS (
          SELECT DISTINCT ON (workspace_id, transaction_id, client_key)
                 workspace_id, transaction_id, client_key, chain_id, combined_end
            FROM _availment_refresh_metrics
           WHERE chain_size >= 2
           ORDER BY workspace_id, transaction_id, client_key, combined_end DESC NULLS LAST, chain_id DESC
        )
        INSERT INTO accounts.availment_chain_members
          (workspace_id, line_item_id, transaction_id, client_key, group_id,
           combined_end, transaction_date, line_status, sort_end, sort_bucket,
           line_started_at, line_ends_at)
        SELECT li.workspace_id, li.id, li.transaction_id, COALESCE(li.client_id, -1),
               g.id, s.combined_end, t.transaction_date, li.status, li.ends_at,
               CASE WHEN li.status = 'active' AND li.ends_at IS NOT NULL THEN 0 ELSE 1 END::smallint,
               li.started_at, li.ends_at
          FROM accounts.transaction_line_items li
          JOIN accounts.transactions t
            ON t.id = li.transaction_id AND t.workspace_id = li.workspace_id
          JOIN latest_subgroup s
            ON s.workspace_id = li.workspace_id
           AND s.transaction_id = li.transaction_id
           AND s.client_key = COALESCE(li.client_id, -1)
          JOIN accounts.availment_chain_groups g
            ON g.workspace_id = s.workspace_id
           AND g.transaction_id = s.transaction_id
           AND g.client_key = s.client_key
           AND g.chain_id = s.chain_id
         WHERE li.workspace_id = p_workspace_id
           AND li.transaction_id = p_transaction_id
           AND COALESCE(li.client_id, -1) = p_client_key
           AND li.status != 'voided'
           AND (li.duration_value IS NULL OR li.duration_unit IS NULL);
      END
      $fn$
    `);
    await client.query(`
      CREATE OR REPLACE FUNCTION accounts.process_availment_projection_dirty(
        p_limit integer DEFAULT 20
      ) RETURNS integer
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = accounts, pg_catalog
      AS $fn$
      DECLARE
        item record;
        processed integer := 0;
      BEGIN
        FOR item IN
          SELECT workspace_id, transaction_id, client_key
            FROM accounts.availment_projection_dirty
           ORDER BY dirty_at
           FOR UPDATE SKIP LOCKED
           LIMIT GREATEST(1, LEAST(p_limit, 100))
        LOOP
          PERFORM accounts.refresh_availment_projection_key(
            item.workspace_id, item.transaction_id, item.client_key
          );
          DELETE FROM accounts.availment_projection_dirty
           WHERE workspace_id = item.workspace_id
             AND transaction_id = item.transaction_id
             AND client_key = item.client_key;
          processed := processed + 1;
        END LOOP;
        RETURN processed;
      END
      $fn$
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`DROP TRIGGER IF EXISTS trg_availment_projection_dirty ON accounts.transaction_line_items`);
    await client.query(`DROP TRIGGER IF EXISTS trg_availment_transaction_date_dirty ON accounts.transactions`);
    await client.query(`DROP FUNCTION IF EXISTS accounts.process_availment_projection_dirty(integer)`);
    await client.query(`DROP FUNCTION IF EXISTS accounts.refresh_availment_projection_key(integer, integer, integer)`);
    await client.query(`DROP FUNCTION IF EXISTS accounts.mark_availment_transaction_date_dirty()`);
    await client.query(`DROP FUNCTION IF EXISTS accounts.mark_availment_projection_dirty()`);
    await client.query(`DROP TABLE IF EXISTS accounts.availment_projection_dirty`);
    await client.query(`DROP INDEX IF EXISTS accounts.idx_availment_members_ws_subgroup_line`);
    await client.query(`
      ALTER TABLE accounts.availment_chain_members
        DROP COLUMN IF EXISTS transaction_id,
        DROP COLUMN IF EXISTS client_key
    `);
  },
};

export default migration;
