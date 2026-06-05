type MigrationContext = { client: import("pg").PoolClient };

// Decommission the legacy on-disk path column. Attachments are object-storage
// only now: every row carries a public s3_link (the prod data was backfilled
// before this shipped, and new uploads set it at INSERT), and the delete path
// derives the S3 key from s3_link via s3KeyFromUrl — so file_path has no
// remaining reader.
//
// Safe on populated tables: a backfill populates any straggler s3_link by
// deriving the same URL the app produces (S3_CDN_URL + /uploads/ + file_path)
// BEFORE the NOT NULL, so the constraint can never abort. On prod this backfill
// matches zero rows (already populated) and is a no-op; it only fires on an env
// where the column was added but not yet populated (e.g. a snapshot restore).
// The column-exists check makes re-running a clean no-op.
const migration = {
  name: "transactions_0005_drop_file_path",
  async up({ client }: MigrationContext) {
    const present = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'accounts'
          AND table_name = 'transaction_attachments'
          AND column_name = 'file_path'`,
    );
    if (present.rows.length === 0) return; // already dropped — idempotent

    const cdn = (process.env.S3_CDN_URL || "https://cdn.hilinga.com").replace(/\/+$/, "");
    await client.query(
      `UPDATE accounts.transaction_attachments
          SET s3_link = $1 || '/uploads/' || file_path
        WHERE s3_link IS NULL
          AND file_path IS NOT NULL
          AND file_path NOT LIKE 'blob:%'`,
      [cdn],
    );
    await client.query(
      `ALTER TABLE accounts.transaction_attachments ALTER COLUMN s3_link SET NOT NULL`,
    );
    await client.query(
      `ALTER TABLE accounts.transaction_attachments DROP COLUMN file_path`,
    );
  },
};

export default migration;
