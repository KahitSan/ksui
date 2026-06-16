# @kahitsan/ksui

## 0.10.1

### Patch Changes

- eef7eaa: Add an optional `closeOnSelect` prop to ComboBox multi mode. When set, the results popup closes after each add/create (the input keeps focus and reopens on the next keystroke) instead of staying open for rapid multi-add. Lets a consumer whose popup overlays a click target below it — e.g. the POS package grid — avoid the lingering popup eating the next click.

## 0.10.0

### Minor Changes

- 816c761: Rename EntityPicker to ComboBox and add a multi-select mode. The single-select API is unchanged (only the component/type names differ: ComboBox, ComboBoxProps, ComboBoxSingleProps, ComboBoxMultiProps). The new multiple mode renders an inline chips + input row with an ordered T[] value, add/remove, backspace-to-remove, inline create, optional primaryStar ordering (value[0] is the starred primary with click-to-promote), an invalid/required tone, and lockedIds for anchored chips. Both modes share one popup engine (picker-engine), so there is a single copy of the debounced search, positioning, and dismissal logic.

## 0.9.0

### Minor Changes

- dee01bb: Remove the ClientPicker and PayeePicker preset components. The library now ships a single picker — EntityPicker — and consumers wire the payee/client endpoint (search / onCreate / icon / noun) at the call site. The PayeeOption, PayeeKind, and ClientOption option types remain exported (decoupled into picker-types) so existing type imports keep working.

## 0.8.0

### Minor Changes

- 1f7b78d: Add `EntityPicker<T>` — a generic searchable-combobox engine (trigger + portal popup, debounced search, viewport-aware positioning, inline create, graceful degradation). `ClientPicker` and `PayeePicker` are now thin presets over it, so there's one copy of the popup mechanics. Their public APIs are unchanged. New pickers can use `EntityPicker` directly by supplying `search` / `onCreate` / `idOf` / `labelOf` / `icon` / `noun`.

## 0.7.1

### Patch Changes

- 46111ac: Add a `./components/*` subpath export. Non-host consumers (e.g. the kahitsan-web
  marketing site) can now import a single standalone primitive —
  `@kahitsan/ksui/components/base/Button` — without resolving the barrel
  (`.`), which re-exports host-coupled components that import `@kserp/host-ui`.

  Also relaxes `Button`'s polymorphic `as` prop back to `any` so callers can pass
  a component with its own required props (e.g. SolidJS Router's `A`, which
  requires `href`); the previous `Component<Record<string, unknown>>` rejected
  those `as={A}` usages.

## 0.7.0

### Minor Changes

- 75ae430: Add the marketing-surface component set consolidated from `kahitsan-web`:
  Button, ThemeToggle, Dropdown, SocialLinksBar, StatusIndicator, SectionHeading,
  NotFound, and EyebrowBadge. Promotes these reusable widgets into the library so
  callers can drop their per-app copies.

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
