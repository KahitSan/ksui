// Grants app_authenticated CRUD on public.payees + its sequence, so the RLS
// policy (adopted in transactions_0011) engages behind the resource router's
// non-owner role. Adopted from the retired payees plugin; idempotent + additive
// (every GRANT no-ops on re-run, nothing revoked).

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0012_grant_payees",
  async up({ client }: MigrationContext) {
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON public.payees TO app_authenticated`,
    );
    // Resolve the SERIAL sequence by introspection: on a DB where a
    // `payees_id_seq` already existed, Postgres auto-named this column's sequence
    // `payees_id_seq1`, so a hardcoded name would miss it and INSERT would fail
    // with "permission denied for sequence".
    await client.query(`
      DO $$
      DECLARE seq text := pg_get_serial_sequence('public.payees', 'id');
      BEGIN
        IF seq IS NOT NULL THEN
          EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO app_authenticated', seq);
        END IF;
      END $$;
    `);
  },
  // No down(): revoking would break the live payees reads/writes. Additive.
  async down(_ctx: MigrationContext) {},
};

export default migration;
