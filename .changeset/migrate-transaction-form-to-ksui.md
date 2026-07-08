---
"@kahitsan/kplugin_finance": patch
---

Move TransactionForm and its sub-components (AccountPicker, FormAdvancedSection, SalesBodyEditor, TransferFeeChip, TransferAccountsPicker) into `@kahitsan/ksui`, so the counter plugin's staff-dashboard expense entry can reuse the real form instead of a hand-forked copy. No behavior change on this plugin's own `/transactions` page -- same components, now imported from ksui.
