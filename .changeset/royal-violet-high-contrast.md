---
"@kahitsan/kplugin_finance": minor
---

Add a third Royal Violet variant, `high-contrast` (`appearance: "dark"`), per THEME-SPEC-V2.1-DYNAMIC-VARIANTS.md §7.2 — the addendum's own end-to-end proof that a theme's `variants` map works past the v2 two-key (`dark`/`light`) special case. Pure-black surfaces + pure-white text/borders push royal-violet's identity (violet primary, gold accent, lifted in luminance) to WCAG-AAA-adjacent contrast (body text ≥7:1, UI/accent pairs ≥4.5:1 — verified with a standalone relative-luminance script, values iterated until every pairing passed).

`royal-violet` bumps `1.1.0` → `1.2.0`. Additive only — `variants.dark`/`variants.light` are byte-for-byte unchanged, so this ships no visual regression for existing users. **Sequenced after the kernel PR that lands the v2.1 loader** (open `variantId` map, `appearance` inference, `MAX_VARIANTS_PER_THEME`): the current kernel on this branch is still v2-only and its `isInvalidVariantsShape` check drops the *entire* contributed theme when `variants` contains any key other than `dark`/`light`, so deploying this manifest change ahead of that kernel PR would silently pull Royal Violet from every workspace that has it selected, not just withhold the new variant. Do not deploy before the kernel PR is live.
