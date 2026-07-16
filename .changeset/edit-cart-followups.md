---
"@kahitsan/kplugin_finance": minor
---

apply-cart-edit accepts a `{ started_at }` addition anchor (a new package for
an existing customer now anchors at that customer's original session start
instead of "now") and an optional `reassign_payer_to` field, with an atomic
is_payer flip + transactions.client_id resync and a 409
`PAYER_REASSIGNMENT_REQUIRED` guard when a save would otherwise strand
billing attribution on a zero-active-line group. customer-group-started-at
now accepts `customer_group_id: null` for legacy/synthetic transactions,
matching the client's documented intent.
