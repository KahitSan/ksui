# @kahitsan/ksui

## 0.19.0

### Minor Changes

- 9c7c466: Add the U4 declarative foreign-data contract to `ResourceUiSpec`: an optional `foreign` descriptor on `UiColumn` (`source: { peer, field, joinKey? }` + `onError: "hide"|"dash"|"warn"`), plus `resolveForeignValue(col, row, resolver?)` — a throw-on-unwired seam so a spec can DECLARE a peer-sourced column before the host consent model can serve it (foreign reads fail loud, never silently empty). Purely additive; existing specs are unaffected.

## 0.18.0

### Minor Changes

- 29375a8: ResourcePage: forward an optional `pageLength` + `lengthMenu` from the spec to the
  list DataTable, so a host can drive the initial rows-per-page (e.g. a resolved
  route-settings `pageSize` preference). Additive — omitting them keeps DataTable's
  existing defaults (10 / [10, 25, 50, 100]).

## 0.17.1

### Patch Changes

- 582e72a: Harden `ResourcePage` against an inline `host` prop. `headerActions` is now a render function (`() => JSX.Element`) instead of a pre-created element, and the component reads `props.host` once at setup. Previously, passing an inline `host={{ ... headerActions: <X/> }}` literal caused the action element to re-instantiate outside the render scope on every `props.host.*` access (e.g. during a save), throwing if that element used render-scoped context. Consumers now pass `headerActions: () => <X/>`.

## 0.17.0

### Minor Changes

- 8ed723b: Make `ResourcePage` fully transport- and auth-agnostic. The component no longer assumes any app, tenancy, or auth model: the `host` prop now injects a generic `can(permission)` check, a `requestInit()` seam for per-request headers/credentials, a `refetchKey()` trigger, optional `headerActions`, and the `PageShell` layout — replacing the previous host-coupled hooks and the hard-coded tenant header. The `share` field was dropped from `ResourceUiSpec` in favor of `host.headerActions`. The component carries no consumer-specific assumptions.

## 0.16.0

### Minor Changes

- aaeeb74: Add `ResourcePage` — a spec-driven default-datatable runtime. A base plugin's list/create/edit/archive page is expressed as a declarative `ResourceUiSpec` (columns with render hints, form fields, filters, labels) and rendered through `ResourcePage`, which composes the existing DataTable + Modal + FormField + StatusPill + SegmentedFilter + DetailRow primitives. Host primitives (PageShell, PageShareButton, and the workspace/permission hooks) are injected via a `host` prop, so the library stays standalone — it never imports the host UI kit. Also exports the pure spec helpers (`buildListQuery`, `validateForm`, `formToBody`, `emptyFormValues`, `rowToFormValues`, `endpoints`, …) and the `ResourceUiSpec` type vocabulary. Proven byte-for-behavior against the hand-written payees page.

### Patch Changes

- 0931bdf: Add vitest + @solidjs/testing-library component test harness with first 14 tests covering Modal (dialog rendering, Escape dismissal, dismissable flag, size, tone), DataTable (column headers, row rendering, empty state, search placeholder), and DatePicker (trigger label, popover open, day selection, disabled state). Establishes the dedup source: a plugin UI test must NOT re-assert widget behaviors covered here.

## 0.15.2

### Patch Changes

- e4b32e2: Avatar: keep `name`/`image` reactive (getter-backed) so a live parent rebind re-renders instead of snapshotting at init.

## 0.15.1

### Patch Changes

- d2dc789: SearchableSelect: fix popup positioning so it hugs the trigger. The popup no longer flips far above the trigger when there is usable space below, and when it does flip up it anchors by its bottom edge to sit right above the trigger instead of floating a fixed POPUP_MAX_HEIGHT away.

## 0.15.0

### Minor Changes

- 16f0ba9: SearchableSelect: full-featured standalone picker (triggerClass/compact trigger/allowClear/loading) — restores pre-migration look.

## 0.14.0

### Minor Changes

- 8d35717: Add generic `Avatar` (person/user avatar wrapping `AccountAvatar`) and `SearchableSelect` (single-select with client-side search wrapping `ComboBox`) components. Both are domain-free, letting plugins drop the kernel `@kserp/host-ui` Avatar/SearchableSelect wrappers.

## 0.13.2

### Patch Changes

- ac98aed: Remove all "kserp" references from source comments so the library ships clean to downstream consumers. No code changes — comment-only cleanup across 19 files.

## 0.13.1

### Patch Changes

- 9a2a4bf: Fix Modal card background default from slate-blue (#11161f) to zinc (#18181b) to match the rest of the library's neutral-dark token set. Also convert tailwind.js from CJS to ESM so it loads correctly under Tailwind v4's `@plugin` directive.

## 0.13.0

### Minor Changes

- 7daf4e1: Add Tailwind CSS plugin for automatic utility class safelisting

  Ship `@kahitsan/ksui/tailwind` — a Tailwind plugin that safelists every
  utility class ksui components reference (button intents, DataTable styles,
  Modal, StatusPill, FormErrorBanner, CopyButton, etc.). Without the plugin,
  Tailwind may purge these classes from node_modules, causing missing
  backgrounds or borders on Button, DataTable, DatePicker, and other components.

  Setup:

  - Tailwind v3: `plugins: [require("@kahitsan/ksui/tailwind")]`
  - Tailwind v4: `@plugin "@kahitsan/ksui/tailwind";`

## 0.12.0

### Minor Changes

- a6c3e8e: Add `DatePicker` (and its `DateRangeValue` type): a self-contained calendar date
  picker ported from the host kit — a trigger button labeled with the selected date
  or "Pick date", a portaled calendar popover with month navigation, natural-language
  text entry, quick options, single-date and range mode, and an optional time field.
  It injects its own CSS sharing the DataTable's `--ksui-dt-*` palette, with no
  Tailwind and no `@kserp/*` / `@kahitsan/*` dependency.

  The `DataTable` date filter now renders this `DatePicker` (single + range) instead
  of a native `<input type="date">`, matching the host DataTable. The fetch-param
  wiring is unchanged: single-date mode still sends `dateFilter`, and range mode
  still sends `dateFrom` / `dateTo`.

## 0.11.0

### Minor Changes

- 82d1239: add: DataTable (server/client-side table with search, sort, pagination)
- f9411c9: Make ksui a fully standalone component library — it no longer depends on `@kserp/host-ui`.

  Every component now depends only on `solid-js` + `lucide-solid` and injects its own CSS. The components that used to import host-kit pieces are self-contained: `CameraCapture`, `ImageCropper`, and `FormActions` use ksui's own `Button`; `ImageCropper` uses the new self-contained `Modal`; `ExistingAttachmentTile` uses the new `confirm`; `ComboBox`/`MarkdownNotes` use the new built-in `highlightMatch`. New exports: `Modal`, `confirm`, `highlightMatch`/`HighlightedText`/`matchesQuery`/`matchesAny`, `useFocusTrap`/`autoFocusOnMount`/`lockPullToRefresh`/`unlockPullToRefresh`, and the optional host-integration helpers `configurePermissions`/`configureActiveWorkspace`/`canAccess`/`getActiveWorkspaceId` (components degrade gracefully when these are not configured).

  BREAKING: the `@kahitsan/ksui/host-ui` ambient type-contract subpath (`host-ui.d.ts`) is removed — the `@kserp/host-ui` ambient now lives in the kernel. Consumers that referenced `@kahitsan/ksui/host-ui` must repoint to the kernel-owned contract.

## 0.10.2

### Patch Changes

- 3fdd9c4: Fix a flicker when adding an item in ComboBox multi mode. The results popup rendered its list from freshly-built wrapper objects each pass, so the `<For>` could not reconcile and tore the whole list down on every change; it now iterates the stable search results and reconciles by reference. With `closeOnSelect`, the popup also now closes before the value changes, so the about-to-be-hidden list no longer re-renders in view.

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
