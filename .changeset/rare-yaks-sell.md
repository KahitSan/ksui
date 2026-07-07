---
"@kahitsan/kplugin_finance": patch
---

Refine the transaction recording form, move transfer fee entry next to the amount, render assigned account icons, classify transfer fee rows as other expense, and link the transfer to its fee expense so editing either one keeps them in sync (edit form pre-fills the fee, changes propagate on save, removing the fee deletes the linked row).
