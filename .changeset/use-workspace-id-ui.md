---
"@kahitsan/kplugin_transactions": patch
---

Phase 2 of the org→workspace rename: switch the plugin UI from the host's `useActiveOrg()` / `activeOrg()?.org_id` to `useActiveWorkspace()` / `activeWorkspace()?.ws_id`. The kernel keeps `organization_id` as a synced shadow until Phase 3, so this is safe.
