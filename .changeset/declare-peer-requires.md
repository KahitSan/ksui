---
"@kahitsan/kplugin_finance": patch
---

Declare the two peer service calls the code already makes (`service:findPackagesByIds@packages`, `service:validate@vouchers`) in the manifest `requires`, so they survive the kernel's fail-closed RPC gate.
