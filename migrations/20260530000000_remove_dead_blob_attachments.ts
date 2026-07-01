// Remove dead `blob:` attachment rows.
//
// The pre-multipart upload model (replaced by the multipart POST /:id/attachments
// handler) persisted the browser's `URL.createObjectURL(...)` preview URL as
// file_path instead of uploading the bytes. Those rows look like
// `blob:https://<origin>/<uuid>` — the file never reached the server, so the
// link is permanently broken and the bytes are unrecoverable.
//
// Qualified + idempotent: matches ONLY `blob:%` (relative paths and any real
// http(s) external URLs are left untouched), and a re-run deletes nothing once
// they're gone. New uploads never produce a blob: path, so this won't re-trigger.

type MigrationContext = { client: import("pg").PoolClient };

const migration = {
  name: "transactions_0003_remove_dead_blob_attachments",
  async up({ client }: MigrationContext) {
    const colCheck = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'accounts'
          AND table_name = 'transaction_attachments'
          AND column_name = 'file_path'`,
    );
    if (colCheck.rows.length === 0) return;
    const res = await client.query(
      `DELETE FROM accounts.transaction_attachments WHERE file_path LIKE 'blob:%'`,
    );
    console.log(`[transactions_0003] removed ${res.rowCount ?? 0} dead blob: attachment row(s)`);
  },
  async down() {
    // Irreversible: these rows pointed at files that never existed on disk, so
    // there is nothing to restore. No-op.
  },
};

export default migration;
