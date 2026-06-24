---
"@kahitsan/kplugin_transactions": patch
---

U4/M3: publish an inter-plugin offer surface. The manifest adds `exposes` for two read capabilities — `transactions:capacity` (method `getPackageCapacityUsage`, consumed by packages for foreign capacity reads) and `transactions:read` (method `findById`, consumed by the page-only analytics plugin via a frontend call-token). Both are `risk: low`, `visibility: public`, and delegate `transactions.view`. Manifest-only, additive: no route or service code changes, and nothing is reachable until a workspace consents the edge.
