---
"@kahitsan/kplugin_transactions": patch
---

Counter can now change the assigned client in a group booking. Added three PATCH routes (client-pool, customer-group-started-at, customer-group-client) for editing customer groups without creating extensions. The payer's client change now syncs to the transaction level so the counter listing reflects the updated name.
