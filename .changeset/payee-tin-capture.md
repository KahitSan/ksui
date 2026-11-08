---
"@kahitsan/ksui": minor
---

TransactionForm can show the picked payee's TIN and address, ask for them when missing, and warn when withholding is on without a TIN. Opt in by passing `setPayeeTin` (and optionally `payeeTin`, `payeeAddress`, `setPayeeAddress`). Adds `isValidTin` and `normalizeTin`, and `tin` and `address` on `PayeeOption`.
