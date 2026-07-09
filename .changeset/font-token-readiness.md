---
"@kahitsan/ksui": minor
---

`DataTable`'s 4 hardcoded monospace `font-family` declarations now route through `var(--ks-font-mono, <exact current stack>)`, matching the color-token fallback discipline (THEME-SPEC-V2 §3): an untheme'd host renders byte-identical to today, a themed host resolving `--ks-font-mono` picks it up automatically. Adds `--ks-font-body`/`--ks-font-heading`/`--ks-font-mono` to `tokens/ks-tokens.json` as a reference for the `check:tokens` fallback gate. Every other component inherits font-family from its host (`grep -rn "font-family|fontFamily" src` confirmed no other thematic hits); `AccountAvatar`'s initials-circle SVG font stays a literal — it renders through a data-URI `<img>`, an isolated document that CSS custom properties on the host page cannot reach.
