---
"@kahitsan/kplugin_transactions": patch
---

Re-apply the workspace_id form of the accounts.* RLS helper + tenant policies on
production. Repairs `accounts.txn_org()` (it read the now-dropped
`organization_id` column after the kernel Phase 3 migration) and re-points the
six tenant policies from the kernel's `auth.org_id()` alias onto
`auth.workspace_id()`, unblocking removal of that alias. Also drops the broad
`transaction_edits_org_isolation` FOR ALL policy that the kernel hard-rename
re-introduced, restoring the append-only audit hardening (SELECT + INSERT only).
Logic-preserving; no-op on a fresh DB.
