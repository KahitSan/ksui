---
"@kahitsan/kplugin_transactions": patch
---

Active rentals stay visible on today's counter board even when the cashier rang them up under yesterday's date. Previously, a still-running session whose receipt was backdated would silently disappear from "Live" the moment the day rolled over Manila midnight, even though the rental was visibly in progress; it only reappeared when staff flipped to "Yesterday".
