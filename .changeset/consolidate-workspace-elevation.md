---
"@kahitsan/kplugin_transactions": patch
---

Consolidate the duplicated superuser/workspace-admin bypass check (privacy + backdate gates) into a single import from `@kahitsan/plugin-sdk`'s new `isWorkspaceElevated` export, replacing 6 independent hand-rolled copies.
