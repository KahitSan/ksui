---
"@kahitsan/kplugin_transactions": patch
---

Fix concurrent capacity counting to include expired (unsettled) sessions and exclude sessions whose ends_at has passed. Add incoming reservation count to capacity-usage RPC.
