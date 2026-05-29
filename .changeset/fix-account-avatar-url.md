---
"@kahitsan/kplugin_transactions": patch
---

Account logo images in transaction payment legs (visible in the ledger list and the transaction detail modal) now load from the kernel's org-scoped `/assets/` URL instead of the legacy `/api/financial-accounts/:id/logo` endpoint that no longer exists. Previously-broken logos render again.
