// accounts.transaction_customers carries THREE RLS policies with identical
// USING/WITH CHECK expressions — introspected via pg_policy and confirmed
// byte-identical:
//   auth.is_superuser() OR workspace_id = auth.workspace_id()
// They accreted from the table's rename history (transaction_clients ->
// transaction_customer_groups -> transaction_customers): each rename added a
// new policy without dropping the prior. Postgres OR-combines every
// applicable permissive policy per row, so the duplicate two triple the
// per-row predicate-eval cost with zero change in what rows are visible.
// Dropping them leaves the canonical transaction_customers_org_isolation
// policy (the one this plugin's migrations create/repoint — see
// 20260616000000_repoint_rls_to_workspace_id.ts) enforcing the exact same
// USING/WITH CHECK — security posture unchanged, two fewer predicates to
// evaluate per row.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0019_drop_redundant_transaction_customers_rls_policies",
  async up({ client }: MigrationContext) {
    await client.query(`DROP POLICY IF EXISTS transaction_clients_org_isolation ON accounts.transaction_customers`);
    await client.query(`DROP POLICY IF EXISTS transaction_customer_groups_org_isolation ON accounts.transaction_customers`);
  },
  // No down(): the dropped policies were exact duplicates of the surviving
  // canonical one, so there is no isolation behavior to restore.
  async down(_ctx: MigrationContext) {},
};

export default migration;
