---
"@kahitsan/ksui": minor
---

SegmentedFilter: support per-option `disabled` + `disabledNote`. Disabled segments are excluded from arrow-key roving nav and clicks, and expose `aria-disabled` plus the note via `title` and sr-only text. The object option shape is extended (optional fields), so every existing consumer keeps working unchanged.
