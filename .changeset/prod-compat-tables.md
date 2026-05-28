---
"@kahitsan/kplugin_transactions": patch
---

Internal: the transactions plugin now stands up the export-job tracker and the per-transaction running-total table, and on first boot after a restore from the older monolith it moves the legacy customer-link and subcategory rows into their new homes. No visible change — opening an export or recording a payment continues to work the same way.
