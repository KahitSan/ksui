---
"@kahitsan/ksui": patch
---

fix(ProgressBar,LiveTimer): LiveTimer fill fell back to green after COLOR_AMBER was tokenized (commit 4f6ed40 dropped the literal `amber` substring that `ProgressBar`'s `extractColorInfo` matches against the `class` string, so the fill fell through to `COLOR_MAP.green` — a faint green tint that read as "missing" on a dark track). Add an explicit `color?: ProgressColor` prop to `ProgressBar` (where `ProgressColor = keyof typeof COLOR_MAP`, derived not hardcoded); when set, `colorInfo = COLOR_MAP[props.color]`; when unset, falls back to the existing `extractColorInfo(class)` class-substring path — fully backward compatible, every existing consumer unchanged. `LiveTimer` now passes `color={colorName()}` derived from its existing scenario logic (COUNTDOWN_TIMER band: <=25% green, 26–75% amber, >75% red; static scenarios mapped to their colors). Also fixes a latent gap: `SCENARIO_COMPLETED` previously fell through to green by default; now correctly `slate`.
