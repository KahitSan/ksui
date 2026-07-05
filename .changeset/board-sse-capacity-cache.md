---
"@kahitsan/kplugin-transactions": patch
---

Add a workspace-scoped board-change signal: every successful write bumps a version that (a) feeds a new SSE endpoint `GET /api/transaction-line-items/events` so counter terminals refresh instantly on cross-terminal writes, and (b) invalidates a short-TTL in-process cache in front of `getPackageCapacityUsage`, absorbing repeated capacity polls between writes.
