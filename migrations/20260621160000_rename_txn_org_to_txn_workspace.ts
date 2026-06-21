// Rename accounts.txn_org() -> accounts.txn_workspace().
//
// "org" is not a tenancy term here — the unit is the WORKSPACE. This is a pure
// rename of the SECURITY DEFINER helper that returns a transaction's parent
// workspace_id (body, hardening, and grants are identical to txn_org). It
// repoints the three child-table policies that call it, then drops the old
// org-named function. No TS code references txn_org (it lives only in RLS
// policies), so this is a DB-only rename.
//
// Idempotent + roll-forward: CREATE OR REPLACE for the new function, DROP POLICY
// IF EXISTS + CREATE for each policy (so a re-run repoints cleanly), DROP
// FUNCTION IF EXISTS for the old one (safe once no policy references it).

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  async up({ client }: MigrationContext) {
    // 1. New workspace-named helper — identical to the old txn_org. A fixed
    // search_path is mandatory hardening for a SECURITY DEFINER function.
    await client.query(`
      CREATE OR REPLACE FUNCTION accounts.txn_workspace(txn_id integer)
      RETURNS integer
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = accounts, public
      AS $fn$ SELECT workspace_id FROM accounts.transactions WHERE id = txn_id $fn$;
    `);
    await client.query(`REVOKE ALL ON FUNCTION accounts.txn_workspace(integer) FROM PUBLIC`);
    await client.query(
      `GRANT EXECUTE ON FUNCTION accounts.txn_workspace(integer) TO app_authenticated`,
    );

    // 2. Repoint the three child-table policies onto the renamed helper. Same
    // predicate (superuser OR the parent transaction's workspace matches the
    // request's workspace) — only the function name changes.
    for (const [table, policy] of [
      ["transaction_visibility", "tv_via_parent"],
      ["transaction_visibility_role", "tvr_via_parent"],
      ["transaction_attachments", "ta_via_parent"],
    ] as const) {
      await client.query(`DROP POLICY IF EXISTS ${policy} ON accounts.${table}`);
      await client.query(`
        CREATE POLICY ${policy} ON accounts.${table}
          USING (auth.is_superuser() OR accounts.txn_workspace(transaction_id) = auth.workspace_id())
          WITH CHECK (auth.is_superuser() OR accounts.txn_workspace(transaction_id) = auth.workspace_id())
      `);
    }

    // 3. Drop the old org-named helper now that nothing references it.
    await client.query(`DROP FUNCTION IF EXISTS accounts.txn_org(integer)`);
  },
};

export default migration;
