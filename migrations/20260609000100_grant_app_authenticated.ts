// Step 2 of the plugin-SDK roadmap — RLS activation for the transactions plugin.
//
// With `withTenantContext` mounted (server/main.ts), every authenticated query
// runs as the non-owner role `app_authenticated` so this plugin's dormant RLS
// policies engage as a second wall behind the explicit organization_id filter.
// That role holds no privileges by default, so it needs USAGE on the `accounts`
// schema plus CRUD on its tables and USAGE on its sequences. The shared kernel
// migration (20260609000000_grant_app_authenticated_shared) already granted it
// the auth-schema helpers the policies call.
//
// Idempotent + additive: every GRANT is a no-op on re-run and nothing is
// revoked. ALL TABLES / ALL SEQUENCES covers the schema's current objects; the
// ALTER DEFAULT PRIVILEGES lines cover any table/sequence a future migration
// adds (created by the same migration role). The `accounts` schema may be shared
// with a sibling plugin; granting here is safe and overlaps idempotently.
//
// No down(): revoking would break any plugin already routing through
// app_authenticated (and any sibling sharing `accounts`). Additive, leave in place.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0007_grant_app_authenticated",
  async up({ client }: MigrationContext) {
    await client.query(`GRANT USAGE ON SCHEMA accounts TO app_authenticated`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA accounts TO app_authenticated`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA accounts TO app_authenticated`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA accounts GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_authenticated`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA accounts GRANT USAGE, SELECT ON SEQUENCES TO app_authenticated`,
    );
  },
};

export default migration;
