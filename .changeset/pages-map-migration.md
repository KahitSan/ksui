---
"@kahitsan/kplugin_finance": minor
---

Adopt the pages-map remote contract: the host now dispatches /transactions, /payees, /financial-accounts and /analytics from the exported `pages` map instead of an in-plugin Switch on routeBase, so an unmapped route fails loud instead of silently rendering the transactions page. Requires a kernel with the pages-map remote contract.
