---
"@kahitsan/kplugin_finance": minor
---

Support changing or removing a customer group's voucher during a cart edit (`voucher_changes` on `PATCH` cart-edit), and fix the group's discount not resetting to zero when its voucher is removed mid-edit. Transaction detail now resolves each customer group's voucher into the full code/type/value/limits shape instead of a bare id, with the same resolution mirrored onto the top-level transaction for legacy single-customer transactions that have no customer-group rows.
