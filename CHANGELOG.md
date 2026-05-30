# @kahitsan/kplugin_transactions

## 0.1.6

### Patch Changes

- e81cead: Sales fixes: per-customer vouchers applied at the counter now discount the bill correctly, and receipt photos and attachments now upload and display reliably (previously some images failed to save and showed a broken link).

## 0.1.5

### Patch Changes

- 5914e0f: Account logo images in transaction payment legs (visible in the ledger list and the transaction detail modal) now load from the kernel's org-scoped `/assets/` URL instead of the legacy `/api/financial-accounts/:id/logo` endpoint that no longer exists. Previously-broken logos render again.

## 0.1.4

### Patch Changes

- 9e67d88: Active rentals stay visible on today's counter board even when the cashier rang them up under yesterday's date. Previously, a still-running session whose receipt was backdated would silently disappear from "Live" the moment the day rolled over Manila midnight, even though the rental was visibly in progress; it only reappeared when staff flipped to "Yesterday".
- 9e67d88: Fix counter charges failing for multi-customer receipts. Previously, ringing up two or more customers on the same receipt returned "transaction_date and started_at must be provided together" and the charge wouldn't post. Mixed-customer receipts now record correctly, each customer's start time is honored on their own line items, and a batch code stamps the receipt so staff can recognize rows that belong to the same group booking.

## 0.1.3

### Patch Changes

- af79da3: Transaction receipt and attachment images now load from the kernel's new org-scoped `/assets/` URL. Previously-broken images will render again once their files are restored on the new server.

## 0.1.2

### Patch Changes

- c2acd59: Record Transaction and Export Transactions modals now use their intended width (≈48rem at large screens, ≈42rem at medium) instead of stretching across the full window. The account-picker tiles inside the modal also switch from 2 columns to 3 columns at tablet widths as designed.

## 0.1.1

### Patch Changes

- 9b0da27: Internal: the transactions plugin now stands up the export-job tracker and the per-transaction running-total table, and on first boot after a restore from the older monolith it moves the legacy customer-link and subcategory rows into their new homes. No visible change — opening an export or recording a payment continues to work the same way.
