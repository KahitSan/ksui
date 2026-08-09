---
"@kahitsan/ksui": minor
---

VoucherPicker: preview a discount range before anything is priced

New optional `subtotalRange` prop. While `subtotal` is still 0 the rows show the
span the discount could land in (e.g. −₱20.00–₱24.00) instead of a meaningless
−₱0.00; once the cart has a real subtotal the row collapses back to the single
exact amount. Omitting the prop keeps today's behavior.
