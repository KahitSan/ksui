---
"@kahitsan/kplugin_finance": patch
---

Fix `POST /api/transaction-line-items/:id/extend` and `POST /api/transaction-line-items/:id/charge-overage` silently dropping the parent transaction's voucher discount: both now re-apply the attached voucher (transaction-level or per-customer-group) against the new subtotal instead of adding the raw cost increase to `amount` untouched.
