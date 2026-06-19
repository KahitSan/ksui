---
"@kahitsan/ksui": patch
---

Add vitest + @solidjs/testing-library component test harness with first 14 tests covering Modal (dialog rendering, Escape dismissal, dismissable flag, size, tone), DataTable (column headers, row rendering, empty state, search placeholder), and DatePicker (trigger label, popover open, day selection, disabled state). Establishes the dedup source: a plugin UI test must NOT re-assert widget behaviors covered here.
