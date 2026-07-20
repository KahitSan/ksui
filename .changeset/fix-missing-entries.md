---
"@kahitsan/kplugin_finance": patch
---

Fix `GET /api/transaction-line-items` silently dropping a today-dated line item when it shares a transaction and client with other bookings. The combined-stay aggregation groups non-voided time-bound lines into a chain per transaction + client (package_id not part of the key) and combines a run whenever it is continuously occupied — a chain breaks only on a real gap against the running maximum end seen so far, not just the immediately preceding line. This fixes both a false break from a shorter line nested inside a longer still-covering one, and a false break caused by a sibling with a NULL `ends_at`, either of which could previously split a genuinely continuous stay and bucket part of it into the past.
