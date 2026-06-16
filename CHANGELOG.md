# @kahitsan/ksui

## 0.6.0

### Minor Changes

- 43a7651: Add `PayeePicker` — a searchable combobox for the "Paid to" / "Received from" / "Payable to" field, a composite ERP picker alongside `ClientPicker` / `VoucherPicker`. Fetches the payees plugin's `/api/payees` with graceful degradation and an optional create-new-payee flow. Lets plugins drop their vendored copies.

## 0.5.0

### Minor Changes

- 201e4de: Add `DateTile` — a compact, domain-free calendar day cell (top band + big value + optional sub-label) that callers repeat into a ledger-style row of days. Interactive (selectable button with `aria-pressed`) when given `onToggle`, otherwise a static dimmed cell. Lets plugins drop their per-plugin copies.

## 0.4.0

### Minor Changes

- dda87d7: Add the base, composite, and utils component set. Promote reusable widgets
  consolidated from the plugins: StatusPill, SegmentedFilter, CopyButton, KpiCard,
  RadioCardGroup, FormErrorBanner, TagPill, SecretReveal, FormActions, FormField,
  DetailRow, Tooltip, ImageCropper, ProgressBar, LiveTimer, and ChartLegend, plus
  the formatPHP, formatShortDate, and formatFullDate helpers. Source is now
  organized into base, composite, and utils folders.

## 0.3.0

Extracted from `kserp/packages/plugin-ui` (`@kahitsan/plugin-ui@0.3.0`) into its own
repository, `KahitSan/ksui`, and renamed to `@kahitsan/ksui`. The component set,
exports, and the `@kserp/host-ui` type contract are carried over byte-for-byte; the
version is continued from the source package to preserve semver lineage.
