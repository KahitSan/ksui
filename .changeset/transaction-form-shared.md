---
"@kahitsan/ksui": minor
---

Add `TransactionForm` and its supporting composites (`AccountRadioPicker`, `FormAdvancedSection`, `SalesBodyEditor`, `TransferFeeChip`, `TransferAccountsPicker`) — a full transaction create/edit form (category picker, amount/date/payee/attachments, tax/EWT/sharing advanced fields, sales package cart, account transfer flow) for any app recording money movement against a `/api/transactions`-shaped endpoint. `simpleMode` hides the Type picker and advanced-fields toggle for a caller that locks `category` to one value.
