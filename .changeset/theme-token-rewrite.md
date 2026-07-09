---
"@kahitsan/ksui": minor
---

Rewrite every component's hardcoded dark-mode colors to the `--ks-*` theme token system (THEME-SPEC.md §1.2/§1.4/§6a): each color reference is now `var(--ks-<token>, <exact dark literal>)` so an untheme'd host renders byte-identical to today's dark UI, while a themed host (once the kernel resolves and applies the 62-token allowlist) picks up the resolved value automatically. Existing `--ksui-<component>-*` override vars stay the live read-point ahead of the new token in a 3-level fallback chain, preserving external overrides. Adds a shared `injectCSS` util replacing the per-component `document.createElement('style')` dedup pattern, and an automated `check:tokens` gate asserting every fallback is byte-identical to its token's dark default.
