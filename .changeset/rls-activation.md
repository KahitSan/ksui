---
"@kahitsan/kplugin_transactions": patch
---

Activate row-level security: mount the kernel's withTenantContext middleware so every authenticated query runs under the org-scoped app_authenticated role, and scope each explicit transaction via applyTenantContext. Adds a migration granting app_authenticated the privileges it needs on the accounts schema.

Also fixes a latent infinite-recursion in the transaction visibility RLS policies. The transactions policy referenced transaction_visibility and the visibility policies referenced transactions back, which only surfaced once RLS actually runs as a non-owner role (it was dormant under the owner connection). The visibility child tables now scope through a SECURITY DEFINER parent-org lookup that reads the parent without re-entering the policy stack, so RLS enforces org isolation while the application layer continues to enforce per-row visibility.
