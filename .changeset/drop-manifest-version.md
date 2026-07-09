---
"@kahitsan/kplugin_finance": patch
---

Remove the vestigial `version` field from `plugin.manifest.json`; `package.json` is the single version source of truth (the kernel already reads it for cache-busting and release tagging). Requires the paired kserp kernel change tolerating a manifest with no `version`.
