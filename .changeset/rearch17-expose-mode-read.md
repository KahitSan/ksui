---
"@kahitsan/kplugin_transactions": patch
---

Declare `mode: "read"` on the `transactions:capacity` and `transactions:read`
exposed capabilities so the consent policy folds them (low/read/public ⇒ implicit
grant). Also adds the Gate-4b cross-subsystem smoke test (roles + consent +
transport composed, with adversarial negatives that fail closed server-side).
