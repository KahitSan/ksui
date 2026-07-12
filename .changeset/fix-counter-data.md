---
"@kahitsan/kplugin_finance": patch
---

Rescheduling a settled booking into the future now reopens it (status back to active), and a reschedule that matches no booking now fails loudly with a 404 instead of silently succeeding.
