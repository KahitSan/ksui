---
"@kahitsan/kplugin_transactions": minor
---

Add `POST /:id/forfeit` to write off a sale's remaining balance (no-show / past refund window). Writes the transaction's `amount` down to what was actually collected, settles any still-active line items, and records an audit trail — already-collected payments are left untouched.
