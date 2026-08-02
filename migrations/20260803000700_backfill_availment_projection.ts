type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "availment_0008_backfill_chain_projection",
  async up({ client }: MigrationContext) {
    const existing = await client.query<{ present: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM accounts.availment_chain_groups LIMIT 1)
          OR EXISTS (SELECT 1 FROM accounts.availment_chain_members LIMIT 1)
        AS present
    `);
    if (existing.rows[0]?.present) return;

    await client.query(`TRUNCATE accounts.availment_chain_members, accounts.availment_chain_groups RESTART IDENTITY`);
    await client.query(`
      CREATE TEMP TABLE _availment_projection_metrics ON COMMIT DROP AS
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
        WHERE sib.status != 'voided'
          AND sib.started_at IS NOT NULL
          AND sib.duration_value IS NOT NULL
          AND sib.duration_unit IS NOT NULL
        WINDOW w AS (
          PARTITION BY sib.transaction_id, sib.workspace_id, COALESCE(sib.client_id, -1)
          ORDER BY sib.started_at, sib.ends_at, sib.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        )
      ), availment_chain_ids AS (
        SELECT
          f.*,
          SUM(chain_break) OVER (
            PARTITION BY transaction_id, workspace_id, client_key
            ORDER BY started_at, ends_at, id
            ROWS UNBOUNDED PRECEDING
          ) AS chain_id
        FROM availment_chain_flags f
      ), availment_chain_metrics AS (
        SELECT
          a.*, 
          (
            MIN(started_at) OVER chain_window
            + COALESCE(SUM(CASE WHEN duration_unit = 'hour'
                                THEN duration_value * COALESCE(quantity, 1) END) OVER chain_window, 0) * INTERVAL '1 hour'
            + COALESCE(SUM(CASE WHEN duration_unit = 'day'
                                THEN duration_value * COALESCE(quantity, 1) END) OVER chain_window, 0) * INTERVAL '1 day'
            + COALESCE(SUM(CASE WHEN duration_unit = 'month'
                                THEN duration_value * COALESCE(quantity, 1) END) OVER chain_window, 0) * INTERVAL '1 month'
          ) AS combined_end,
          COUNT(*) OVER chain_window AS chain_size
        FROM availment_chain_ids a
        WINDOW chain_window AS (
          PARTITION BY transaction_id, workspace_id, client_key, chain_id
        )
      )
      SELECT
        m.id,
        m.transaction_id,
        m.workspace_id,
        m.client_key,
        m.chain_id,
        m.combined_end,
        m.chain_size,
        t.transaction_date,
        li.status AS line_status,
        li.ends_at AS sort_end,
        CASE WHEN li.status = 'active' AND li.ends_at IS NOT NULL THEN 0 ELSE 1 END::smallint AS sort_bucket,
        li.started_at AS line_started_at,
        li.ends_at AS line_ends_at
      FROM availment_chain_metrics m
      JOIN accounts.transaction_line_items li
        ON li.id = m.id AND li.workspace_id = m.workspace_id
      JOIN accounts.transactions t
        ON t.id = m.transaction_id AND t.workspace_id = m.workspace_id
    `);
    await client.query(`ANALYZE _availment_projection_metrics`);

    await client.query(`
      INSERT INTO accounts.availment_chain_groups
        (workspace_id, transaction_id, client_key, chain_id, transaction_date, combined_end, chain_size)
      SELECT DISTINCT workspace_id, transaction_id, client_key, chain_id,
                      transaction_date, combined_end, chain_size
      FROM _availment_projection_metrics
      WHERE chain_size >= 2
      ON CONFLICT (workspace_id, transaction_id, client_key, chain_id)
      DO UPDATE SET transaction_date = EXCLUDED.transaction_date,
                    combined_end = EXCLUDED.combined_end,
                    chain_size = EXCLUDED.chain_size,
                    updated_at = now()
    `);
    await client.query(`
      INSERT INTO accounts.availment_chain_members
        (workspace_id, line_item_id, group_id, combined_end, transaction_date,
         line_status, sort_end, sort_bucket, line_started_at, line_ends_at)
      SELECT m.workspace_id, m.id, g.id, m.combined_end, m.transaction_date,
             m.line_status, m.sort_end, m.sort_bucket, m.line_started_at, m.line_ends_at
      FROM _availment_projection_metrics m
      JOIN accounts.availment_chain_groups g
        ON g.workspace_id = m.workspace_id
       AND g.transaction_id = m.transaction_id
       AND g.client_key = m.client_key
       AND g.chain_id = m.chain_id
      WHERE m.chain_size >= 2
    `);
    await client.query(`
      WITH latest_subgroup AS (
        SELECT DISTINCT ON (workspace_id, transaction_id, client_key)
               workspace_id, transaction_id, client_key, chain_id, combined_end
        FROM _availment_projection_metrics
        WHERE chain_size >= 2
        ORDER BY workspace_id, transaction_id, client_key, combined_end DESC NULLS LAST, chain_id DESC
      )
      INSERT INTO accounts.availment_chain_members
        (workspace_id, line_item_id, group_id, combined_end, transaction_date,
         line_status, sort_end, sort_bucket, line_started_at, line_ends_at)
      SELECT li.workspace_id, li.id, g.id, s.combined_end, t.transaction_date,
             li.status, li.ends_at,
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
      WHERE li.status != 'voided'
        AND (li.duration_value IS NULL OR li.duration_unit IS NULL)
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`TRUNCATE accounts.availment_chain_members, accounts.availment_chain_groups RESTART IDENTITY`);
  },
};

export default migration;
