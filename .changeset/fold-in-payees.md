---
"@kahitsan/kplugin_transactions": minor
---

feat: fold payees into the transactions plugin (multi-route). One process now
serves `/api/transactions` + `/api/payees` and contributes both a Transactions
and a Payees nav entry via the manifest `routes[]`. The payees CRUD + `findByIds`
run in-process (the former cross-plugin RPC to `kplugin_payees` is now a direct
`public.payees` query); the `public.payees` table + RLS + grants are adopted via
idempotent, schema-qualified migrations. Retires the standalone `kplugin_payees`
(removed from the deploy roster in the same rollout).
