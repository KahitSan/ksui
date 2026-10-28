---
"@kahitsan/ksui": patch
---

Modal: a `variant="sheet"` Modal no longer closes on Escape while a dialog Modal or `confirm()` is open on top of it. Only the topmost layer reacts, so the sheet and its form survive.
