---
"@kahitsan/kplugin_transactions": patch
---

fix: register GET /grouped-by-date route

The "group sales per day" table view fetched `/api/transactions/grouped-by-date`, but no such route was registered — the request fell through to the `GET /:id` detail handler, which parsed the literal `"grouped-by-date"` as an integer id and errored with `invalid input syntax for type integer`. The UI degraded to an empty grouped view. Adds the documented sales-only per-day aggregate endpoint (registered ahead of `/:id`) returning `{ data: [{date, count, total, currency}], total }`, filtered identically to the list so the per-day counts match the day drilldown.
