---
"@kahitsan/kplugin_finance": minor
---

Contribute the "Royal Violet" theme via `plugin.manifest.json`'s `contributes.themes` (THEME-SPEC.md §4.3) — the first real third-party-pipeline theme, proving a plugin can ship its own brand palette (violet primary/accent, `#7c3aed`–`#a78bfa`) without touching kernel code.

This manifest change causes a kernel reload on deploy (its SHA changes) — kserp's tier-aware loader parses `contributes.themes` at plugin-load time and registers the entry namespaced as `finance:royal-violet`.

Migrated to THEME-SPEC-V2-VARIANTS.md's shape (`v1.1.0`): the flat `base`/`tokens` fields are replaced by `variants.dark`/`variants.light`, and a new light-violet variant (`--ks-bg: #f7f3ff`, `--ks-primary: #6d28d9`) ships alongside the existing dark palette so Royal Violet renders correctly in both modes. Sequenced after the kernel PR that ships the v2 loader (§7 of the addendum) — deploy this only once that loader is live.
