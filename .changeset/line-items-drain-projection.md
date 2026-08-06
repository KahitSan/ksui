---
"@kahitsan/kplugin_finance": patch
---

Drain the availment projection on line-items writes (extend, charge-overage) so a read issued right after the write sees the new line instead of racing the background refresh.
