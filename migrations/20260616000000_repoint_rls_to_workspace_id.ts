// Re-apply the workspace_id form of the accounts.* RLS helper + policies on
// production.
//
// `accounts.txn_org()` and the six tenant policies below were edited to use
// `workspace_id` / `auth.workspace_id()` in earlier migrations, but those
// migrations had already run on prod, so prod still carries the pre-edit form:
//   - `accounts.txn_org()` reads `organization_id` — a column the kernel Phase 3
//     migration has now DROPPED, so the function is broken on prod.
//   - the six policies still call the kernel's `auth.org_id()` alias.
// This migration re-applies the current definitions idempotently: it repairs
// `txn_org()` and re-points every policy onto `auth.workspace_id()`, which lets
// the kernel finally drop the `auth.org_id()` / `auth.org_role()` aliases. The
// policy LOGIC is unchanged (auth.org_id() ≡ auth.workspace_id()); only the
// function name moves. No-op on a fresh DB that already has the new form.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0009_repoint_rls_to_workspace_id",
  async up({ client }: MigrationContext) {
    // 1. Repair the SECURITY DEFINER parent-org lookup to read workspace_id.
    await client.query(`
      CREATE OR REPLACE FUNCTION accounts.txn_org(txn_id integer)
      RETURNS integer
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = accounts, public
      AS $fn$ SELECT workspace_id FROM accounts.transactions WHERE id = txn_id $fn$;
    `);
    await client.query(`REVOKE ALL ON FUNCTION accounts.txn_org(integer) FROM PUBLIC`);
    await client.query(`GRANT EXECUTE ON FUNCTION accounts.txn_org(integer) TO app_authenticated`);

    // 2. Parent-scoped child-table policies (via the SECURITY DEFINER helper).
    for (const [table, policy] of [
      ["transaction_visibility", "tv_via_parent"],
      ["transaction_visibility_role", "tvr_via_parent"],
      ["transaction_attachments", "ta_via_parent"],
    ] as const) {
      await client.query(`DROP POLICY IF EXISTS ${policy} ON accounts.${table}`);
      await client.query(`
        CREATE POLICY ${policy} ON accounts.${table}
          USING (auth.is_superuser() OR accounts.txn_org(transaction_id) = auth.workspace_id())
          WITH CHECK (auth.is_superuser() OR accounts.txn_org(transaction_id) = auth.workspace_id())
      `);
    }

    // 3. Direct workspace-scoped policies.
    await client.query(`DROP POLICY IF EXISTS transaction_customers_org_isolation ON accounts.transaction_customers`);
    await client.query(`
      CREATE POLICY transaction_customers_org_isolation ON accounts.transaction_customers
        USING (auth.is_superuser() OR workspace_id = auth.workspace_id())
        WITH CHECK (auth.is_superuser() OR workspace_id = auth.workspace_id())
    `);

    // transaction_edits is append-only: SELECT-only + INSERT-only policies (no
    // UPDATE/DELETE policy → those are denied), preserving the audit hardening.
    // The kernel hard-rename on prod re-created a broad FOR ALL
    // `transaction_edits_org_isolation` policy; drop it so UPDATE/DELETE stay
    // denied. (IF EXISTS → no-op where it was never present.)
    await client.query(`DROP POLICY IF EXISTS transaction_edits_org_isolation ON accounts.transaction_edits`);
    await client.query(`DROP POLICY IF EXISTS transaction_edits_select ON accounts.transaction_edits`);
    await client.query(`
      CREATE POLICY transaction_edits_select ON accounts.transaction_edits
        FOR SELECT
        USING (auth.is_superuser() OR workspace_id = auth.workspace_id())
    `);
    await client.query(`DROP POLICY IF EXISTS transaction_edits_insert ON accounts.transaction_edits`);
    await client.query(`
      CREATE POLICY transaction_edits_insert ON accounts.transaction_edits
        FOR INSERT
        WITH CHECK (auth.is_superuser() OR workspace_id = auth.workspace_id())
    `);
  },
};

export default migration;
