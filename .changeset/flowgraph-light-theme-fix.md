---
"@kahitsan/ksui": patch
---

Fix FlowGraph rendering white-on-white in light theme: the SVG arrowhead marker's `fill` attribute and the node card's border were left on a bare `rgba(255,255,255,…)` fallback outside the `--ks-fg` token chain — invisible/near-invisible on a light background. Both now route through `var(--ksui-fg-edge/-node-border, color-mix(in srgb, var(--ks-fg, #ffffff) N%, transparent))`, matching every other rule in the component. Corrects a prior `docs/THEME-EXCEPTIONS.md` audit note that had wrongly signed these off as already converted.
