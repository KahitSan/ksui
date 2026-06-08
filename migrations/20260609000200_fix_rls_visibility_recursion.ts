// Step 2 of the plugin-SDK roadmap — fix the latent RLS recursion that blocks
// activating row-level security on the transactions tables.
//
// THE BUG (pre-existing, only exposed now that RLS actually runs as a non-owner
// role): the transactions policies and the visibility child-table policies
// reference EACH OTHER's tables, so under active RLS each policy re-triggers the
// other and Postgres aborts with "infinite recursion detected in policy for
// relation transaction_visibility":
//   * transactions.txn_select / txn_update do `EXISTS (... FROM transaction_visibility ...)`
//   * transaction_visibility.tv_via_parent (and tvr/ta_via_parent) do `EXISTS (... FROM transactions ...)`
// It never fired before because the owner connection bypasses RLS entirely.
//
// THE FIX follows the roadmap's model — RLS enforces ORG isolation; the app
// layer enforces per-row visibility (is_private / created_by / visibility lists):
//
//  1. The detailed per-command policies on `transactions` (txn_select / txn_update
//     / txn_delete / txn_insert) are redundant: they are PERMISSIVE, so they
//     OR-combine with `transactions_org_isolation` (PERMISSIVE, FOR ALL,
//     `organization_id = auth.org_id()`), which already permits every org row for
//     every command. A permissive policy can only widen, never narrow — so these
//     four add nothing to access control (they even carry a self-compare bug,
//     `tv.transaction_id = tv.id`). RLS therefore never actually hid a private
//     transaction; the app's WHERE clauses do. We drop the four so nothing
//     cross-references the visibility tables.
//
//  2. The child tables (transaction_visibility / _role / attachments) have no
//     organization_id column, so they scope through the parent. We replace their
//     recursive parent-EXISTS policies with an org check via a SECURITY DEFINER
//     helper, `accounts.txn_org(id)`, which reads the parent's org AS THE FUNCTION
//     OWNER — bypassing RLS on `transactions`, so it cannot re-enter the policy
//     stack. This keeps org isolation on the child tables with no recursion.
//
// Non-destructive: only policies + one function change; no table/data touched.
// Idempotent: DROP ... IF EXISTS + CREATE OR REPLACE.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0008_fix_rls_visibility_recursion",
  async up({ client }: MigrationContext) {
    // 1. SECURITY DEFINER org lookup — reads accounts.transactions as the owner,
    // so a policy that calls it does NOT re-trigger RLS on transactions.
    // A fixed search_path is mandatory hardening for SECURITY DEFINER functions.
    await client.query(`
      CREATE OR REPLACE FUNCTION accounts.txn_org(txn_id integer)
      RETURNS integer
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = accounts, public
      AS $fn$ SELECT organization_id FROM accounts.transactions WHERE id = txn_id $fn$;
    `);
    await client.query(`REVOKE ALL ON FUNCTION accounts.txn_org(integer) FROM PUBLIC`);
    await client.query(`GRANT EXECUTE ON FUNCTION accounts.txn_org(integer) TO app_authenticated`);

    // 2. Drop the redundant, recursive per-command policies on transactions.
    // `transactions_org_isolation` (FOR ALL, org match) remains the org gate.
    await client.query(`DROP POLICY IF EXISTS txn_select ON accounts.transactions`);
    await client.query(`DROP POLICY IF EXISTS txn_update ON accounts.transactions`);
    await client.query(`DROP POLICY IF EXISTS txn_delete ON accounts.transactions`);
    await client.query(`DROP POLICY IF EXISTS txn_insert ON accounts.transactions`);

    // 3. Replace the recursive child-table policies with org-only checks via the
    // SECURITY DEFINER helper. (NULL org for an orphan child row fails the check,
    // so a child row with no live parent is denied — correct.)
    for (const table of [
      "transaction_visibility",
      "transaction_visibility_role",
      "transaction_attachments",
    ]) {
      const policy =
        table === "transaction_visibility"
          ? "tv_via_parent"
          : table === "transaction_visibility_role"
            ? "tvr_via_parent"
            : "ta_via_parent";
      await client.query(`DROP POLICY IF EXISTS ${policy} ON accounts.${table}`);
      await client.query(`
        CREATE POLICY ${policy} ON accounts.${table}
          USING (auth.is_superuser() OR accounts.txn_org(transaction_id) = auth.org_id())
          WITH CHECK (auth.is_superuser() OR accounts.txn_org(transaction_id) = auth.org_id())
      `);
    }
  },
};

export default migration;
