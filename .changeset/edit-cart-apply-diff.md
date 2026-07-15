---
"@kahitsan/kplugin_finance": minor
---

Add POST /api/transactions/:id/apply-cart-edit for POS edit-cart item removal — cashiers can now reduce or void original items on an existing charge (package swap on the same transaction) while preserving the recorded payment and reprising the balance downward. The endpoint runs inside a single DB transaction with a FOR UPDATE lock, replays idempotently via edit_token, computes the line diff server-side, and writes transaction_edits audit rows. Guards against an empty resulting cart (EMPTY_CART) and against editing a transaction with a refund on it (REFUND_BLOCKED, refunds are intentionally out of scope). The same parent-lifecycle guard (voided/forfeited parent) now also covers line-item void, extend, and charge-overage.
