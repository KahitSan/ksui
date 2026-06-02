---
"@kahitsan/kplugin_transactions": patch
---

Fixed upcoming line items appearing in the counter board when viewing past dates. The upcoming section previously used only `started_at > NOW()` without reference to the selected date, so future bookings were visible even on yesterday's scope.
