---
"@kahitsan/kplugin_transactions": patch
---

fix: recompute ends_at when a customer-group started_at is edited

The counter "edit time-in" action (PATCH /:id/customer-group-started-at) moved
started_at without recomputing ends_at, leaving an inverted window
(ends_at < started_at) that bucketed today's session onto yesterday's board.
ends_at now tracks the edited start, and a data-repair migration heals rows
already corrupted by the old behavior.
