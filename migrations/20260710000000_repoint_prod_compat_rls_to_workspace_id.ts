// Repoints (and ensures) RLS on the two prod-compat tables adopted in
// transactions_0002 (accounts.export_jobs, accounts.transaction_amount_paid).
//
// Both tables are declared with a `workspace_id` column in the CREATE TABLE IF
// NOT EXISTS statement that created them (transactions_0002), but that
// statement never ran an ENABLE ROW LEVEL SECURITY / CREATE POLICY step for
// them — unlike every other org-scoped table in this plugin. On a DB that
// inherited these two tables from a `pg_restore` of the pre-fork monolith
// (see transactions_0002's header), the restored rows can carry the
// monolith's ORIGINAL policy, which calls `auth.org_id()` — dropped by the
// kernel's Phase 3 migration — so any RLS-gated query against these tables
// now errors instead of enforcing tenant isolation. Idempotent: ENABLE ROW
// LEVEL SECURITY no-ops if already enabled, DROP POLICY IF EXISTS covers both
// the never-existed and inherited-legacy-name cases, and CREATE POLICY always
// lands the correct workspace_id/auth.workspace_id() predicate.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0015_repoint_prod_compat_rls_to_workspace_id",
  async up({ client }: MigrationContext) {
    for (const [table, policy] of [
      ["export_jobs", "export_jobs_org_isolation"],
      ["transaction_amount_paid", "transaction_amount_paid_org_isolation"],
    ] as const) {
      await client.query(`ALTER TABLE accounts.${table} ENABLE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS ${policy} ON accounts.${table}`);
      await client.query(`
        CREATE POLICY ${policy} ON accounts.${table}
          USING (auth.is_superuser() OR workspace_id = auth.workspace_id())
          WITH CHECK (auth.is_superuser() OR workspace_id = auth.workspace_id())
      `);
    }
  },
  // No down(): dropping the policy would remove tenant isolation on live rows.
  async down(_ctx: MigrationContext) {},
};

export default migration;
