---
"@kahitsan/kplugin_finance": patch
---

Security hardening: reject a charge whose `destination_account_id` belongs to another workspace, repoint the stale `export_jobs`/`transaction_amount_paid` RLS policies onto `auth.workspace_id()`, validate every `:id`/`:paymentId`/`:attachmentId`/`:lineItemId` path param before it reaches SQL, replace remaining `RETURNING */SELECT *` on `accounts.transactions`/`accounts.transaction_line_items` with explicit column lists, and cap client-supplied money amounts at the `NUMERIC(12,2)` ceiling so an oversized value returns a clean 400 instead of a raw Postgres error.
