type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "availment_0012_grant_projection_worker_schema_usage",
  async up({ client }: MigrationContext) {
    await client.query(`GRANT USAGE ON SCHEMA accounts TO app_service_role`);
  },
  async down({ client }: MigrationContext) {
    await client.query(`REVOKE USAGE ON SCHEMA accounts FROM app_service_role`);
  },
};

export default migration;
