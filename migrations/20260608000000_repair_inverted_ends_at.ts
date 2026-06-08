type MigrationContext = { client: import("pg").PoolClient };

// Repair line items whose window was inverted by the old "edit time-in" path.
//
// PATCH /:id/customer-group-started-at used to move `started_at` without
// recomputing `ends_at`. Since the insert always stores
// `ends_at = started_at + duration`, an edit that pushed `started_at` past the
// stale `ends_at` left `ends_at < started_at` — an impossible window. The
// natural-day CASE in routes-line-items.ts then bucketed the line by its old
// (earlier) `ends_at` date, so a session whose start is TODAY surfaced on
// YESTERDAY's board. The route now recomputes `ends_at` on every start edit;
// this migration heals the rows that were already corrupted before that fix.
//
// Safe + idempotent on populated tables: only rows with a strictly inverted
// window (`ends_at < started_at`) and a computable duration are touched, and
// the rebuilt `ends_at = started_at + duration` is always >= started_at, so a
// re-run matches zero rows. A negative window cannot legitimately exist (you
// cannot end before you start), so there is no good row to clobber. Voided
// lines are left alone. Matches the insert formula in helpers-charge.ts and the
// recompute in routes.ts (value * INTERVAL '1 <unit>').
const migration = {
  name: "transactions_0006_repair_inverted_ends_at",
  async up({ client }: MigrationContext) {
    await client.query(
      `UPDATE accounts.transaction_line_items
          SET ends_at = CASE duration_unit
                          WHEN 'hour'
                            THEN started_at + (duration_value * COALESCE(quantity, 1)) * INTERVAL '1 hour'
                          WHEN 'day'
                            THEN started_at + (duration_value * COALESCE(quantity, 1)) * INTERVAL '1 day'
                          WHEN 'month'
                            THEN started_at + (duration_value * COALESCE(quantity, 1)) * INTERVAL '1 month'
                        END,
              updated_at = NOW()
        WHERE status <> 'voided'
          AND started_at IS NOT NULL
          AND ends_at IS NOT NULL
          AND duration_value IS NOT NULL
          AND duration_unit IS NOT NULL
          AND ends_at < started_at`,
    );
  },
};

export default migration;
