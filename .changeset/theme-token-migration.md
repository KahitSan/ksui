---
"@kahitsan/kplugin_finance": patch
---

Migrate UI to the theme token system (`--ks-*` via Tailwind v4 `@theme`), replacing hardcoded zinc/amber/red/emerald/blue palette classes and raw hex/rgb literals so the plugin renders correctly once the workspace theme resolves to something other than the built-in dark default.
