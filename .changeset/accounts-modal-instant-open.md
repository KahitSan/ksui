---
"@kahitsan/kplugin_finance": patch
---

Open the financial-accounts detail modal instantly on click instead of waiting on the fetch — it now renders a skeleton (matching the transaction detail pattern) while the account loads, and ignores a stale response for an id the user has since closed or switched away from.
