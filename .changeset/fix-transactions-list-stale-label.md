---
"@kahitsan/kplugin_finance": patch
---

Fix the transactions list showing the original package name after a cart-edit swap. The row summary now reflects the currently active line items instead of the stale description saved at checkout, and a package added during the edit is now labeled "Package — Variant" instead of just the variant name.

Fix the same staleness in the transaction detail modal's title and its edit form: a cart-edit swap now regenerates the transaction's stored description from the currently active line items, so both surfaces stay in sync with the list. The detail route now also derives its description live from the currently active lines (same as the list route), so transactions edited before this fix show the correct title immediately, with no need to re-edit them.

Fix voided line items showing up as "Packages availed" in the transaction detail view and in the transaction edit form — voided lines are now excluded everywhere a transaction's line items are read for display.

Fix the list row title and the detail modal title disagreeing with the "Packages availed" pane on a line written before the description-format fix: a bare description like "4 Hours" made the title read "1× 4 Hours" while the pane, which resolves the package name separately, showed "Inner Area · 4 Hours". Both now resolve the package name from the same place, so a bare description gets the package name prepended ("Package — description") and an already-prefixed charge-format description is left untouched instead of doubled.
