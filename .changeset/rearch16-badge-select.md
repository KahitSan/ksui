---
"@kahitsan/ksui": minor
---

Add generic `BadgeSelect` component (U1 lift).

A domain-free, inline click-to-edit badge picker generalized from kserp's `RoleBadgeSelect`: renders the selected option as a clickable badge, opens a Portal-anchored popup (escapes `overflow:hidden`, flips above the trigger when space is tight), and auto-shows an inline search once options exceed `searchThreshold` (default 5). The caller injects `options`, the `value`↔`label` mapping, and an optional `badgeClass(value)` tone function; nothing role-specific leaks in. `RoleBadgeSelect` is now expressible as a thin wrapper over it. Purely additive.
