---
"@kahitsan/kplugin_transactions": patch
---

Bootstrap via the shared `createPluginServer` helper (T1a). The hand-written Express bootstrap in `server/main.ts` collapses onto `@kahitsan/plugin-sdk`'s `createPluginServer`, which owns the manifest/port/schemas parse, the capped pg pool, on-boot migrations, the health probe, the `/_ui` bundle, `parseIdentity` + the RLS `withTenantContext` wall, RPC services, routers, and `listen`. Behavior-preserving: routes, services, and migrations are unchanged.
