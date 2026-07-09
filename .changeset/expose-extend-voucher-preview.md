---
"@kahitsan/kplugin_finance": patch
---

`GET /api/transaction-line-items` now returns each row's effective voucher discount inputs (`transaction_subtotal`, `customer_group_subtotal`, `customer_group_voucher_id`, `customer_group_discount_amount`, `effective_voucher`) so the Counter Extend modal can preview the post-extend discounted total without drifting from the `/extend` route's own pricing.
