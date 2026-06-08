---
"@kahitsan/kplugin_transactions": patch
---

Harden the cross-day edit-time e2e test against a Manila-midnight flake: when CI runs near 00:00 PHT, the test's `now - 28h` session straddles a day boundary and buckets ambiguously, so it now skips that assertion (matching the existing boundary-skip discipline) instead of failing. No runtime change.
