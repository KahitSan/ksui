---
"@kahitsan/kplugin_finance": patch
---

Security hardening: reject a charge whose `destination_account_id` belongs to another workspace, repoint the stale `export_jobs`/`transaction_amount_paid` RLS policies onto `auth.workspace_id()`, validate every `:id`/`:paymentId`/`:attachmentId`/`:lineItemId` path param before it reaches SQL, replace every `RETURNING *`/`SELECT *`/`t.*` on `accounts.transactions`/`accounts.transaction_line_items` (including the list and detail routes' `SELECT t.*`) with explicit column lists, and cap client-supplied money amounts at the `NUMERIC(12,2)` ceiling so an oversized value returns a clean 400 instead of a raw Postgres error.

Closes the same cross-tenant gap on the routes the charge fix didn't cover: the manual transaction create/edit routes and the `createSalaryTransaction` cross-plugin RPC now assert `source_account_id`/`destination_account_id` ownership before persisting, and the payment-leg routes (add/edit) now assert `financial_account_id` ownership and enforce the `NUMERIC(12,2)` amount ceiling. The `:id` path-param parsing duplicated across `attachments.ts`/`payments.ts` is consolidated into one `parseIntParam` helper.
