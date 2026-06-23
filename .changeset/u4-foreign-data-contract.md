---
"@kahitsan/ksui": minor
---

Add the U4 declarative foreign-data contract to `ResourceUiSpec`: an optional `foreign` descriptor on `UiColumn` (`source: { peer, field, joinKey? }` + `onError: "hide"|"dash"|"warn"`), plus `resolveForeignValue(col, row, resolver?)` — a throw-on-unwired seam so a spec can DECLARE a peer-sourced column before the host consent model can serve it (foreign reads fail loud, never silently empty). Purely additive; existing specs are unaffected.
