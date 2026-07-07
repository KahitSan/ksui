---
"@kahitsan/kplugin_finance": major
---

feat: rename `transactions` → `finance` and fold `financial-accounts` in

- Manifest identity renamed: `name`/`capabilityKey`/`label` → `finance`. `package.json` renamed to `@kahitsan/kplugin_finance`. The standalone `financial-accounts` plugin is retired in the same rollout — its `/api/financial-accounts` URL namespace is preserved via `additionalBasePaths`, so external API consumers keep working.
- Adds a fourth UI route `financial-accounts` (nav label "Accounts", icon `wallet`) served from the same bundle.
- Adopts `accounts.financial_accounts` in this plugin's migration tracker; every statement is idempotent so prod's existing rows are untouched.
- Adds `financial_accounts.{view,create,edit,delete}` permissions to the manifest and mounts the folded-in accounts router.
- Inlines the account-balance query (no more cross-plugin self-RPC round-trip through the kernel now that transactions + accounts live in the same process).
- Exposes `service:findByIds` (accounts resource) so peers resolve account display names without importing this plugin's tables.
