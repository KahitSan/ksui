// Adopts the `public.payees` table into the transactions plugin (payees folded
// in — one process, `/api/transactions` + `/api/payees`). Formerly owned by the
// standalone payees plugin; on prod the table already exists with real rows, so
// every statement is IF [NOT] EXISTS / DROP-then-CREATE and touches no data.
//
// SCHEMA-QUALIFIED to `public.payees` on purpose: the transactions process runs
// with search_path `accounts, public`, so an UNqualified `payees` here would
// create a SECOND empty `accounts.payees` and split the data away from the live
// `public.payees`. The payees table stays in public (no data move) — exactly
// where the standalone plugin (schemas:[]) and the pre-plugin monolith put it.
//
// Runs under plugin='transactions' in the shared (plugin,name) tracker, so it is
// unseen there and executes once; on prod it no-ops against the existing table,
// on a fresh DB it builds it from scratch.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0011_adopt_payees_table",
  async up({ client }: MigrationContext) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.payees (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'vendor',
        default_subcategory TEXT,
        notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // NOT VALID first so the statement doesn't block on unexpected pre-existing
    // rows; validate in the same run once the constraint is in place.
    await client.query(`ALTER TABLE public.payees DROP CONSTRAINT IF EXISTS payees_kind_check`);
    await client.query(`
      ALTER TABLE public.payees
      ADD CONSTRAINT payees_kind_check
      CHECK (kind IN ('vendor', 'customer', 'both')) NOT VALID
    `);
    await client.query(`ALTER TABLE public.payees VALIDATE CONSTRAINT payees_kind_check`);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payees_org_active_name
      ON public.payees (workspace_id, is_active, name)
    `);

    // The create/update conflict target references this exact index.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payees_org_name_kind_unique
      ON public.payees (workspace_id, lower(name), kind)
    `);

    // RLS second wall behind the structural workspace_id filter the resource
    // router injects; auth.* helpers come from the kernel baseline.
    await client.query(`ALTER TABLE public.payees ENABLE ROW LEVEL SECURITY`);
    await client.query(`DROP POLICY IF EXISTS payees_org_isolation ON public.payees`);
    await client.query(`CREATE POLICY payees_org_isolation ON public.payees
      USING (auth.is_superuser() OR workspace_id = auth.workspace_id())
      WITH CHECK (auth.is_superuser() OR workspace_id = auth.workspace_id())`);
  },
  // No down(): dropping public.payees would destroy real prod rows. The table
  // predates this plugin and outlives it; adoption is additive.
  async down(_ctx: MigrationContext) {},
};

export default migration;
