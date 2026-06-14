// Prod-compatibility adapter for the transactions plugin.
//
// Runs AFTER `transactions_0001_create` so the fork-shape tables it expects
// (`accounts.transaction_customers`, `accounts.transaction_subcategories`)
// already exist and are empty. This migration:
//
//   1. **Moves data from prod-named tables into fork-shape tables**, then
//      drops the prod-named originals. Lets a `pg_restore` of the live
//      monolith prod (188.166.229.107) land on the fork without losing the
//      ~7k transaction-customer rows or the 31 transaction subcategories that
//      live under prod names. Idempotent — when the prod-named tables aren't
//      present (a fresh fork install), every block is a no-op:
//
//        a. `accounts.transaction_clients` → `accounts.transaction_customers`
//           (prod uses the older `transaction_clients` name; fork renamed to
//            `transaction_customers` after the monolith but kept identical
//            column shape).
//        b. `public.transaction_subcategories` → `accounts.transaction_subcategories`
//           (prod kept this taxonomy in `public`; fork moved it under the
//            plugin's `accounts` schema).
//
//   2. **Creates two prod-only tables** that fork's transactions plugin
//      doesn't currently own at boot but prod has:
//
//        c. `accounts.export_jobs` — async CSV export job tracker (prod: 4 rows).
//        d. `accounts.transaction_amount_paid` — running totals of how much
//            has been received against a transaction (prod: 459 rows).
//
// The data-move uses `INSERT … SELECT` not `ALTER TABLE … RENAME` because the
// fork-shape target was already created by the previous migration; INSERT
// preserves the existing empty table's constraints, indexes, sequence, and
// RLS policies (whereas a rename would replace them with the prod-named
// table's). After the INSERT the prod-named source is dropped.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0002_prod_compat",
  async up({ client }: MigrationContext) {
    // ─── 1a. Migrate accounts.transaction_clients → transaction_customers ─
    //
    // Column shape on prod and fork is identical: (transaction_id integer,
    // client_id integer, workspace_id integer, position integer DEFAULT 0,
    // created_at timestamptz DEFAULT now()). The previous migration's
    // CREATE made accounts.transaction_customers empty; this INSERT moves
    // prod's rows in.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'accounts' AND table_name = 'transaction_clients'
        ) THEN
          INSERT INTO accounts.transaction_customers
                 (transaction_id, client_id, workspace_id, "position", created_at)
          SELECT  transaction_id, client_id, workspace_id, "position", created_at
            FROM accounts.transaction_clients
          ON CONFLICT DO NOTHING;

          DROP TABLE accounts.transaction_clients;
          RAISE NOTICE 'Moved accounts.transaction_clients → accounts.transaction_customers and dropped the prod-named source';
        END IF;
      END $$
    `);

    // ─── 1b. Move public.transaction_subcategories → accounts.transaction_subcategories ─
    //
    // Same idea: target accounts.transaction_subcategories already exists
    // (empty) from the previous migration. We move prod's 31 rows in,
    // realign the destination's `id` sequence with prod's max id so future
    // inserts don't collide, then drop the prod-shaped public table.
    await client.query(`
      DO $$
      DECLARE
        new_max INTEGER;
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'transaction_subcategories'
        ) THEN
          INSERT INTO accounts.transaction_subcategories
                 (name, applies_to, sort_order, is_active, created_at, updated_at)
          SELECT  p.name, p.applies_to, p.sort_order, p.is_active, p.created_at, p.updated_at
            FROM public.transaction_subcategories p
           WHERE NOT EXISTS (
             SELECT 1 FROM accounts.transaction_subcategories a
              WHERE lower(a.name) = lower(p.name) AND a.applies_to = p.applies_to
           );

          SELECT COALESCE(MAX(id), 0) INTO new_max FROM accounts.transaction_subcategories;
          IF new_max > 0 THEN
            PERFORM setval('accounts.transaction_subcategories_id_seq', new_max);
          END IF;

          DROP TABLE public.transaction_subcategories CASCADE;
          RAISE NOTICE 'Moved public.transaction_subcategories → accounts.transaction_subcategories and dropped the prod-named source';
        END IF;
      END $$
    `);

    // ─── 2c. accounts.export_jobs ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.export_jobs (
        id uuid DEFAULT gen_random_uuid() NOT NULL,
        workspace_id integer NOT NULL,
        user_id text NOT NULL,
        kind text DEFAULT 'transactions'::text NOT NULL,
        date_from date NOT NULL,
        date_to date NOT NULL,
        consolidate boolean DEFAULT false NOT NULL,
        status text DEFAULT 'pending'::text NOT NULL,
        progress_total integer DEFAULT 0 NOT NULL,
        progress_done integer DEFAULT 0 NOT NULL,
        row_count integer,
        byte_size bigint,
        file_path text,
        filename text,
        error_message text,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL,
        expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
        CONSTRAINT export_jobs_check CHECK ((date_from <= date_to)),
        CONSTRAINT export_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'error'::text, 'expired'::text])))
      )
    `);
    await client.query(
      `DO $$ BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'export_jobs_pkey' AND conrelid = 'accounts.export_jobs'::regclass
         ) THEN
           ALTER TABLE accounts.export_jobs ADD CONSTRAINT export_jobs_pkey PRIMARY KEY (id);
         END IF;
       END $$`,
    );
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_export_jobs_expires_at
        ON accounts.export_jobs (expires_at) WHERE status <> 'expired'
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_export_jobs_org_user_created
        ON accounts.export_jobs (workspace_id, user_id, created_at DESC)
    `);

    // ─── 2d. accounts.transaction_amount_paid ────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts.transaction_amount_paid (
        transaction_id integer NOT NULL,
        workspace_id integer NOT NULL,
        amount_paid numeric(12,2) NOT NULL,
        captured_by text NOT NULL,
        captured_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT transaction_amount_paid_amount_paid_check CHECK ((amount_paid >= (0)::numeric))
      )
    `);
    await client.query(
      `DO $$ BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'transaction_amount_paid_pkey'
             AND conrelid = 'accounts.transaction_amount_paid'::regclass
         ) THEN
           ALTER TABLE accounts.transaction_amount_paid
             ADD CONSTRAINT transaction_amount_paid_pkey
             PRIMARY KEY (transaction_id);
         END IF;
       END $$`,
    );
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transaction_amount_paid_org
        ON accounts.transaction_amount_paid (workspace_id)
    `);

    console.log(
      "[transactions_0002] prod-compat applied: moved transaction_clients→transaction_customers " +
        "and public.transaction_subcategories→accounts.transaction_subcategories (each conditional on " +
        "the prod-named source existing); created accounts.export_jobs and accounts.transaction_amount_paid",
    );
  },
  async down({ client }: MigrationContext) {
    // Only reverse the new tables. The two data-moves are deliberately
    // one-way: reversing would require recreating the prod-named source
    // tables and copying data back, which has no operational use case on
    // fork and only complicates the migration runner. If a rollback is ever
    // needed, restore the pre-restore fork DB snapshot.
    await client.query(`DROP TABLE IF EXISTS accounts.transaction_amount_paid CASCADE`);
    await client.query(`DROP TABLE IF EXISTS accounts.export_jobs CASCADE`);
  },
};

export default migration;
