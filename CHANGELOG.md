# @kahitsan/kplugin_transactions

## 0.5.0

### Minor Changes

- 7c3b4ba: Add S3 storage link column to transaction attachments for cloud-based file storage

## 0.4.9

### Patch Changes

- 24d696b: Extensions on overdue counter rentals now chain correctly instead of appearing as duplicate entries on the board.

## 0.4.8

### Patch Changes

- 9d2f743: Fixed a regression where the transaction detail endpoint returned 500 errors after the display_name dynamic resolution was shipped without its client-name lookup variables.

## 0.4.7

### Patch Changes

- a268571: Counter can now change the assigned client in a group booking. Added three PATCH routes (client-pool, customer-group-started-at, customer-group-client) for editing customer groups without creating extensions. The payer's client change now syncs to the transaction level so the counter listing reflects the updated name.

## 0.4.6

### Patch Changes

- 6548cc7: Fixed upcoming line items appearing in the counter board when viewing past dates. The upcoming section previously used only `started_at > NOW()` without reference to the selected date, so future bookings were visible even on yesterday's scope.

## 0.4.5

### Patch Changes

- bbf86e2: Include customer_groups in transaction detail API response so the edit cart correctly renders multi-client bookings.

## 0.4.4

### Patch Changes

- 12f2157: Fix payee not being saved or displayed on transaction create/edit, and resolve "Last updated by" showing "Unknown"

## 0.4.3

### Patch Changes

- d5e8c9e: fix: add missing peer RPC imports so transaction detail and outstanding routes resolve package, variant, and client names without crashing

## 0.4.2

### Patch Changes

- a15ce3a: Fix file attachment upload failing with "file_name is required" error when pasting or selecting files.

## 0.4.1

### Patch Changes

- 277ba15: Restore cashflow endpoint for analytics plugin.

## 0.4.0

### Minor Changes

- 4cff9d2: Add PUT /:id/payments/:paymentId for updating payment amount and financial account. Harden attachment routes with explicit column lists and URL protocol validation.

## 0.3.1

### Patch Changes

- 9880bc6: Fixed batch booking editing in the counter: the transaction detail endpoint now returns customer group data so the editor can properly render each customer's row. Also fixed the client pool name field to match what the counter UI expects.

## 0.3.0

### Minor Changes

- 41662bc: The payment accounts behind each transaction are now surfaced to the counter, so booking cards can show how a customer paid — including when a payment was split across several accounts.

## 0.2.0

### Minor Changes

- d5049be: Powers the new Subscriptions page: lists each client's recurring plan (when it started, when it expires, how many renewals, lifetime value) and lets you renew a plan so the next billing window chains from where the current one ends.

## 0.1.8

### Patch Changes

- 35e5960: An attachment whose file is no longer available now shows a clear "Unavailable"
  placeholder instead of a broken image or dead link, and can still be removed.
- 35e5960: The transactions list and detail view now show the account, payee, and staff
  member for each entry again — including the account name on each payment. If the
  part of the app that owns one of those details is ever unavailable, a small
  warning icon appears in its place so it's clear the name couldn't load rather
  than showing a blank.

## 0.1.7

### Patch Changes

- 5394f91: Adds the daily money-in vs money-out figures that power the new Finance Analytics cash-flow chart.

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
