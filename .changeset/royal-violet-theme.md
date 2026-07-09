---
"@kahitsan/kplugin_finance": minor
---

Contribute the "Royal Violet" theme via `plugin.manifest.json`'s `contributes.themes` (THEME-SPEC.md §4.3) — the first real third-party-pipeline theme, proving a plugin can ship its own brand palette (violet primary/accent, `#7c3aed`–`#a78bfa`) without touching kernel code.

This manifest change causes a kernel reload on deploy (its SHA changes) — kserp's tier-aware loader parses `contributes.themes` at plugin-load time and registers the entry namespaced as `finance:royal-violet`.
