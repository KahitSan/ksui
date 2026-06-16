---
"@kahitsan/ksui": minor
---

Rename EntityPicker to ComboBox and add a multi-select mode. The single-select API is unchanged (only the component/type names differ: ComboBox, ComboBoxProps, ComboBoxSingleProps, ComboBoxMultiProps). The new multiple mode renders an inline chips + input row with an ordered T[] value, add/remove, backspace-to-remove, inline create, optional primaryStar ordering (value[0] is the starred primary with click-to-promote), an invalid/required tone, and lockedIds for anchored chips. Both modes share one popup engine (picker-engine), so there is a single copy of the debounced search, positioning, and dismissal logic.
