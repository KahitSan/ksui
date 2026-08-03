type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "availment_0011_lock_definer_function_privileges",
  async up({ client }: MigrationContext) {
    await client.query(`
      REVOKE ALL ON FUNCTION accounts.mark_availment_projection_dirty() FROM PUBLIC;
      REVOKE ALL ON FUNCTION accounts.mark_availment_transaction_date_dirty() FROM PUBLIC;
      REVOKE ALL ON FUNCTION accounts.refresh_availment_projection_key(integer, integer, integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION accounts.process_availment_projection_dirty(integer, integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION accounts.refresh_availment_projection_key(integer, integer, integer) TO app_service_role;
      GRANT EXECUTE ON FUNCTION accounts.process_availment_projection_dirty(integer, integer) TO app_service_role;
    `);
  },
  async down({ client }: MigrationContext) {
    await client.query(`
      GRANT EXECUTE ON FUNCTION accounts.mark_availment_projection_dirty() TO PUBLIC;
      GRANT EXECUTE ON FUNCTION accounts.mark_availment_transaction_date_dirty() TO PUBLIC;
      GRANT EXECUTE ON FUNCTION accounts.refresh_availment_projection_key(integer, integer, integer) TO PUBLIC;
      GRANT EXECUTE ON FUNCTION accounts.process_availment_projection_dirty(integer, integer) TO PUBLIC;
      REVOKE ALL ON FUNCTION accounts.refresh_availment_projection_key(integer, integer, integer) FROM app_service_role;
      REVOKE ALL ON FUNCTION accounts.process_availment_projection_dirty(integer, integer) FROM app_service_role;
    `);
  },
};

export default migration;
