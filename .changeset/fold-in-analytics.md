---
"@kahitsan/kplugin_transactions": minor
---

feat: fold the Finance Analytics dashboard into the transactions plugin
(multi-route). One process/bundle now serves `/transactions`, `/payees` and the
folded-in `/analytics`, dispatched from the manifest `routes[]` + the remote
`Component` on `routeBase`. Analytics is UI-only — no schema, no server routes:
its dashboard reads endpoints that already live in this plugin
(`/api/transactions/summary`, `/cashflow`, `/api/transactions`) plus a
kernel-proxied browser fetch to `/api/financial-accounts`. The §9 flow graph
merges in via `server/flows-analytics.ts`. Adds the `analytics.view` permission
and the Analytics `nav` (order 0) to the manifest. Retires the standalone
`kplugin_analytics` (removed from the deploy roster in the same rollout).
