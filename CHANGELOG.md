# @kahitsan/kplugin_transactions

## 0.1.2

### Patch Changes

- c2acd59: Record Transaction and Export Transactions modals now use their intended width (≈48rem at large screens, ≈42rem at medium) instead of stretching across the full window. The account-picker tiles inside the modal also switch from 2 columns to 3 columns at tablet widths as designed.

## 0.1.1

### Patch Changes

- 9b0da27: Internal: the transactions plugin now stands up the export-job tracker and the per-transaction running-total table, and on first boot after a restore from the older monolith it moves the legacy customer-link and subcategory rows into their new homes. No visible change — opening an export or recording a payment continues to work the same way.
