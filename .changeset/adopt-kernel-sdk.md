---
"@kahitsan/kplugin_transactions": patch
---

Adopt the kernel plugin SDK for identity and auth, and harden the share-visibility update: clearing a transaction's per-user and per-role visibility now deletes those rows filtered by organization through the kernel's org-scoped database handle.
