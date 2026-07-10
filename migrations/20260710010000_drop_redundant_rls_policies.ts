// accounts.financial_accounts and accounts.transaction_payments each carry
// two RLS policies with identical USING/WITH CHECK expressions — introspected
// via \d+ and confirmed byte-identical:
//   auth.is_superuser() OR workspace_id = auth.workspace_id()
// The short-named ones (fa_org_isolation, tp_org_isolation) predate this
// plugin's own adoption migrations (they never appear in this repo's
// migration history — carried over from the pre-fold-in standalone
// financial-accounts schema) and were left in place alongside the canonical
// long-named policy this plugin's migrations create/repoint. Postgres
// evaluates every applicable permissive policy per row, so the duplicate
// doubles the per-row predicate-eval cost with zero change in what rows are
// visible. Dropping the short-named ones leaves the long-named canonical
// policy enforcing the exact same USING/WITH CHECK — security posture
// unchanged, one less predicate to evaluate per row.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0016_drop_redundant_rls_policies",
  async up({ client }: MigrationContext) {
    await client.query(`DROP POLICY IF EXISTS fa_org_isolation ON accounts.financial_accounts`);
    await client.query(`DROP POLICY IF EXISTS tp_org_isolation ON accounts.transaction_payments`);
  },
  // No down(): the dropped policies were exact duplicates of the surviving
  // canonical ones, so there is no isolation behavior to restore.
  async down(_ctx: MigrationContext) {},
};

export default migration;
