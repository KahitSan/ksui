---
"@kahitsan/ksui": minor
---

Add `PayeePicker` — a searchable combobox for the "Paid to" / "Received from" / "Payable to" field, a composite ERP picker alongside `ClientPicker` / `VoucherPicker`. Fetches the payees plugin's `/api/payees` with graceful degradation and an optional create-new-payee flow. Lets plugins drop their vendored copies.
