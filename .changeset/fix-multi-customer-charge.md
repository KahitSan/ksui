---
"@kahitsan/kplugin_transactions": patch
---

Fix counter charges failing for multi-customer receipts. Previously, ringing up two or more customers on the same receipt returned "transaction_date and started_at must be provided together" and the charge wouldn't post. Mixed-customer receipts now record correctly, each customer's start time is honored on their own line items, and a batch code stamps the receipt so staff can recognize rows that belong to the same group booking.
