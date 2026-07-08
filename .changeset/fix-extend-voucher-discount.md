---
"@kahitsan/kplugin_finance": patch
---

Fix `POST /api/transaction-line-items/:id/extend` silently dropping the parent transaction's voucher discount: it now re-applies the attached voucher (transaction-level or per-customer-group) against the new subtotal instead of adding the raw extension cost to `amount` untouched.
