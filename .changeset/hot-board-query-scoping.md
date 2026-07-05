---
"@kahitsan/kplugin_transactions": patch
---

Scope the counter-board payment CTEs to matched transactions instead of aggregating the whole workspace history (they were the dominant cost of the top query by total prod DB time), and replace the `/outstanding` per-row LATERAL payments sum with one grouped hash join. Response shapes verified byte-identical across param combos.
