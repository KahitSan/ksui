---
"@kahitsan/kplugin_finance": minor
---

Expose a `hasClientAvailedPackage` RPC service (batched by lineage's package ids + a before-date) so packages can evaluate its `client_availed_package_before` eligibility condition over the consent-gated gateway instead of querying `accounts.*` directly.
