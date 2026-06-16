---
"@kahitsan/ksui": minor
---

Add `EntityPicker<T>` — a generic searchable-combobox engine (trigger + portal popup, debounced search, viewport-aware positioning, inline create, graceful degradation). `ClientPicker` and `PayeePicker` are now thin presets over it, so there's one copy of the popup mechanics. Their public APIs are unchanged. New pickers can use `EntityPicker` directly by supplying `search` / `onCreate` / `idOf` / `labelOf` / `icon` / `noun`.
