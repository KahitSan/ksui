---
"@kahitsan/ksui": minor
---

Compact density redesign for `DataTable` (tighter row/header padding, mono uppercase header with a subtle background tint, `nowrap` cells with horizontal scroll instead of text wrapping, and new opt-in `ksui-datatable-td-num` / `-code` / `-badge{,-ok,-warn,-danger}` utility classes). Refined `StatusPill` to a flat borderless chip — dropped the leading dot and forced uppercase, bumped text size for legibility (this removes the `dot` prop). Added a `size?: "sm" | "md"` prop to `Button` for a compact footprint in dense contexts like table row actions; `size` defaults to `"md"`, matching the previous look exactly.
