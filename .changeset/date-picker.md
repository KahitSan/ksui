---
"@kahitsan/ksui": minor
---

Add `DatePicker` (and its `DateRangeValue` type): a self-contained calendar date
picker ported from the host kit — a trigger button labeled with the selected date
or "Pick date", a portaled calendar popover with month navigation, natural-language
text entry, quick options, single-date and range mode, and an optional time field.
It injects its own CSS sharing the DataTable's `--ksui-dt-*` palette, with no
Tailwind and no `@kserp/*` / `@kahitsan/*` dependency.

The `DataTable` date filter now renders this `DatePicker` (single + range) instead
of a native `<input type="date">`, matching the host DataTable. The fetch-param
wiring is unchanged: single-date mode still sends `dateFilter`, and range mode
still sends `dateFrom` / `dateTo`.
