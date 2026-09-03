# @kahitsan/ksui

## 0.39.3

### Patch Changes

- 8cbf471: Match vouchers against aligned package lineages.

## 0.39.2

### Patch Changes

- 86dce3a: Restore compact transaction form tabs, account picker styling, and mock-aligned field ordering.

## 0.39.1

### Patch Changes

- be1d275: Fix compact transaction forms hiding secondary fields until expanded.
- 7fe613d: Use approved font token fallback in compact transaction form styles.

## 0.39.0

### Minor Changes

- 60630ec: Add opt-in compact layout for transaction forms.

## 0.38.3

### Patch Changes

- d27a951: Label sales reference input as Invoice ID and explain automatic and backdated overrides.

## 0.38.2

### Patch Changes

- e2a06a8: VoucherPicker: stack the voucher type label (`20% off`) under the ticket glyph in list rows, and show the staged voucher's description in the picker footer clamped to two lines with a "See more" popup for the full text.

## 0.38.1

### Patch Changes

- 8ff52a9: VoucherPicker: show the voucher's free-text description (`notes`) as a line in each picker row (highlighted on search) and beside the code in the staged draft summary.

## 0.38.0

### Minor Changes

- 0ec7bb2: VoucherPicker: confirm the pick before it applies

  Tapping a row now stages it — the choice reaches `onChange` only when Confirm is
  pressed, so a mis-tap can be corrected in place and Cancel discards the whole
  edit. The footer names the staged voucher and its discount, the button reads
  Apply / Change / Remove to match what pressing it will do, and it stays disabled
  until the staged pick actually differs from what the cart already has. Re-tapping
  the staged row unstages it. Also stops the trigger repeating the peso figure for
  a fixed-amount voucher.

- 2f9f958: VoucherPicker: open a dialog instead of an anchored dropdown

  The trigger now opens a centered modal with a code search box, roomier rows,
  and a per-voucher reason explaining why an ineligible voucher can't be applied
  (below minimum, wrong items, expired, not yet started, inactive) instead of an
  unexplained greyed-out row. `aria-haspopup` moves from `listbox` to `dialog`;
  existing test ids are unchanged.

- 07f6ec9: VoucherPicker: page the list in on scroll, show expiry, highlight the search match

  The picker fetched the whole table (`limit=200`) and filtered in the browser.
  It now requests 25 at a time and pulls the next page when the end of the list
  scrolls into view, and the search box is debounced into the server's `search`
  param so a match is found across every page rather than only the rows already
  downloaded. Rows carry the voucher's expiry ("Expires in 3 days", "Expires
  2026-09-01"), tinted with a clock icon inside the last week, and the matched
  substring is highlighted with the shared `highlightMatch` helper. Date fields
  that arrive as full timestamps are read as their calendar day.

- aec96e0: VoucherPicker: preview a discount range before anything is priced

  New optional `subtotalRange` prop. While `subtotal` is still 0 the rows show the
  span the discount could land in (e.g. −₱20.00 to ₱24.00) instead of a meaningless
  −₱0.00; once the cart has a real subtotal the row collapses back to the single
  exact amount. Omitting the prop keeps today's behavior.

- ad46d64: VoucherPicker: show redemptions used against the limit, and block exhausted codes

  Rows now read "3/10 used" alongside the discount and expiry, tinted amber once
  the remaining redemptions run low. A code with no `usage_limit_total` is
  unlimited and shows nothing. A fully-redeemed code moves to "Not applicable"
  with a "Fully redeemed" reason instead of staying selectable — the server
  already rejects it, so it previously failed only at charge time.

## 0.37.1

### Patch Changes

- 9c686f3: Fix Portal'd popup panels (DatePicker, BadgeSelect, ComboBox, MentionTextarea, PaymentAccountPicker, SearchableSelect, VoucherPicker, AddAttachmentTile) painting under a native `<dialog>` modal, and — the deeper bug — being unclickable even after that fix. Each panel promotes itself into the browser top layer via the Popover API (`popover="manual"` + `showPopover()`), which paints above a `showModal()` dialog regardless of z-index. But `showModal()` also marks everything OUTSIDE the dialog's flat-tree subtree inert, and inertness is computed on the flat tree, not paint order — so a panel Portaled to `document.body` from inside an open dialog was visually on top yet excluded from hit-testing. Every panel now mounts into the ancestor dialog's own `<dialog>` element (via a new `ModalLayerContext` Modal.tsx provides) when one exists, keeping it inside the non-inert subtree; it still falls back to `document.body` for standalone usage and for the sheet Modal variant (a plain `<div>`, never `showModal()`'d, so no inertness barrier exists there).

## 0.37.0

### Minor Changes

- dddfa7a: `VoucherPicker` accepts an optional `fetchUrl` prop (defaults to `/api/vouchers?status=active&limit=200`) so a consumer without `vouchers.view` can point the picker at a same-shape peer proxy endpoint instead of the vouchers plugin's own API.

## 0.36.1

### Patch Changes

- a21527b: fix(ProgressBar,LiveTimer): LiveTimer fill fell back to green after COLOR_AMBER was tokenized (commit 4f6ed40 dropped the literal `amber` substring that `ProgressBar`'s `extractColorInfo` matches against the `class` string, so the fill fell through to `COLOR_MAP.green` — a faint green tint that read as "missing" on a dark track). Add an explicit `color?: ProgressColor` prop to `ProgressBar` (where `ProgressColor = keyof typeof COLOR_MAP`, derived not hardcoded); when set, `colorInfo = COLOR_MAP[props.color]`; when unset, falls back to the existing `extractColorInfo(class)` class-substring path — fully backward compatible, every existing consumer unchanged. `LiveTimer` now passes `color={colorName()}` derived from its existing scenario logic (COUNTDOWN_TIMER band: <=25% green, 26–75% amber, >75% red; static scenarios mapped to their colors). Also fixes a latent gap: `SCENARIO_COMPLETED` previously fell through to green by default; now correctly `slate`.

## 0.36.0

### Minor Changes

- 58c8910: SegmentedFilter: support per-option `disabled` + `disabledNote`. Disabled segments are excluded from arrow-key roving nav and clicks, and expose `aria-disabled` plus the note via `title` and sr-only text. The object option shape is extended (optional fields), so every existing consumer keeps working unchanged.

## 0.35.0

### Minor Changes

- 7ae37f1: `DataTable`'s 4 hardcoded monospace `font-family` declarations now route through `var(--ks-font-mono, <exact current stack>)`, matching the color-token fallback discipline (THEME-SPEC-V2 §3): an untheme'd host renders byte-identical to today, a themed host resolving `--ks-font-mono` picks it up automatically. Adds `--ks-font-body`/`--ks-font-heading`/`--ks-font-mono` to `tokens/ks-tokens.json` as a reference for the `check:tokens` fallback gate. Every other component inherits font-family from its host (`grep -rn "font-family|fontFamily" src` confirmed no other thematic hits); `AccountAvatar`'s initials-circle SVG font stays a literal — it renders through a data-URI `<img>`, an isolated document that CSS custom properties on the host page cannot reach.

## 0.34.1

### Patch Changes

- e0ea57e: Fix FlowGraph rendering white-on-white in light theme: the SVG arrowhead marker's `fill` attribute and the node card's border were left on a bare `rgba(255,255,255,…)` fallback outside the `--ks-fg` token chain — invisible/near-invisible on a light background. Both now route through `var(--ksui-fg-edge/-node-border, color-mix(in srgb, var(--ks-fg, #ffffff) N%, transparent))`, matching every other rule in the component. Corrects a prior `docs/THEME-EXCEPTIONS.md` audit note that had wrongly signed these off as already converted.

## 0.34.0

### Minor Changes

- f61210d: Rewrite every component's hardcoded dark-mode colors to the `--ks-*` theme token system (THEME-SPEC.md §1.2/§1.4/§6a): each color reference is now `var(--ks-<token>, <exact dark literal>)` so an untheme'd host renders byte-identical to today's dark UI, while a themed host (once the kernel resolves and applies the 62-token allowlist) picks up the resolved value automatically. Existing `--ksui-<component>-*` override vars stay the live read-point ahead of the new token in a 3-level fallback chain, preserving external overrides. Adds a shared `injectCSS` util replacing the per-component `document.createElement('style')` dedup pattern, and an automated `check:tokens` gate asserting every fallback is byte-identical to its token's dark default.

  `SegmentedFilter` now carries proper radio semantics: the wrapper is `role="radiogroup"` (honoring a new optional `ariaLabel` prop), each segment is `role="radio"` + `aria-checked`, and arrow keys / Home / End move a roving tabindex per the WAI-ARIA radiogroup pattern — visual output is unchanged. `RadioCardGroup` gains a `disabled` prop (roving tabindex removed, clicks suppressed, `aria-disabled` on the group and every item) so consumers stop faking disabled state with pointer-events CSS. `TransactionForm` is decomposed into `TransactionAccountFields` and `TransactionPayableFields` sibling components — same exported props, same rendered output.

## 0.33.0

### Minor Changes

- 9f48de6: New declarative route/form builder layer over ResourceUiSpec: `defineRoute`, `defineForm`, `col`, `Cell.*`, `table`, `action`, `field.*`, `setting.*`, and `routeToResourceSpec` which lowers a built RouteSpec to the exact ResourceUiSpec a hand-authored spec would produce (throwing on unwired config instead of silently dropping it). ResourcePage remains the single render engine.

## 0.32.0

### Minor Changes

- 00af17d: Add `TransactionForm` and its supporting composites (`AccountRadioPicker`, `FormAdvancedSection`, `SalesBodyEditor`, `TransferFeeChip`, `TransferAccountsPicker`) — a full transaction create/edit form (category picker, amount/date/payee/attachments, tax/EWT/sharing advanced fields, sales package cart, account transfer flow) for any app recording money movement against a `/api/transactions`-shaped endpoint. `simpleMode` hides the Type picker and advanced-fields toggle for a caller that locks `category` to one value.

## 0.31.1

### Patch Changes

- d131c62: Tooltip: add optional `align` ("center" | "start") and `wrap` props so a bubble near a screen/sidebar edge can left-align and wrap instead of centering and overflowing under adjacent chrome.

## 0.31.0

### Minor Changes

- 5e0ba12: Compact density redesign for `DataTable` (tighter row/header padding, mono uppercase header with a subtle background tint, `nowrap` cells with horizontal scroll instead of text wrapping, and new opt-in `ksui-datatable-td-num` / `-code` / `-badge{,-ok,-warn,-danger}` utility classes). Refined `StatusPill` to a flat borderless chip — dropped the leading dot and forced uppercase, bumped text size for legibility (this removes the `dot` prop). Added a `size?: "sm" | "md"` prop to `Button` for a compact footprint in dense contexts like table row actions; `size` defaults to `"md"`, matching the previous look exactly.
- fa1b10a: Add `uploadPendingFiles` to `pending-file` utils — the shared best-effort multipart upload to the transactions plugin's `POST /:id/attachments` route, extracted from the three plugin-local copies (transactions, counter, timesheets/payroll) so attachment upload has one canonical implementation.

## 0.30.0

### Minor Changes

- 12da674: Add `uploadPendingFiles` to `pending-file` utils — the shared best-effort multipart upload to the transactions plugin's `POST /:id/attachments` route, extracted from the three plugin-local copies (transactions, counter, timesheets/payroll) so attachment upload has one canonical implementation.

## 0.29.1

### Patch Changes

- 29d5376: Add PendingFile type + createPendingFile / revokePendingFile helpers for pre-upload file state management

## 0.29.0

### Minor Changes

- 278ac0f: Add `ImageViewer` — a fullscreen image lightbox (Facebook-style): the image centered on a near-opaque backdrop, dismissed by the X button, a backdrop click, or Escape (native `<dialog>` top-layer). ExistingAttachmentTile now uses it: clicking an image attachment opens the viewer instead of a new tab, and a non-image attachment downloads instead of opening a new tab. This is required now that attachments are served as `blob:` object URLs — a `target="_blank"` blob breaks the moment its owning view unmounts and the URL is revoked.

## 0.28.0

### Minor Changes

- 57ad440: ExistingAttachmentTile gains an optional `rawHref` (+ `rawInit`) prop for the proxy/blob source mode: when set, it streams the private object's bytes from that authed same-origin route (via createObjectUrlResource) and renders the resulting blob: with a loading spinner, instead of resolving the public s3_link. Backward-compatible — existing s3_link consumers are unaffected.

## 0.27.0

### Minor Changes

- b3798cc: Add `createObjectUrlResource(href, { init })` — a SolidJS primitive that fetches an authed same-origin route and exposes the bytes as an object URL (`blob:`) for `<img src>` / `<a href>`, revoking the URL on change and on cleanup. This is the proxy/blob pattern for privately-stored assets: the storage origin is never exposed and there is no leakable signed bearer URL. Domain-free — the consumer supplies the href and any headers.

## 0.26.0

### Minor Changes

- 2567907: Refine `buildFlow`/`FlowSteps` (added in 0.25.0, no consumers yet) into a node-graph builder: each step returns a connectable handle and you wire them with `handle.to(target, label?)`, so linear paths chain (`a.to(b).to(c)`) while branches, joins and loops fall out of connecting a handle more than once. The previous version could only express linear chains + binary conditions, which can't represent real flows (lists with many row-actions, loop-backs, converging paths). Still additive sugar over `defineFlow`, still domain-free.

## 0.25.0

### Minor Changes

- 9015d10: Add `buildFlow` + `FlowSteps` — a small, optional node-step authoring DSL for composing a `FlowDefinition` by chaining steps (`f.trigger(...).load(...).commit(...)`) with a forking `condition(label, onYes, onNo)` that captures both branches. It lowers to the same `FlowDefinition` the FlowGraph renders, so it's purely additive sugar over `defineFlow` — consumers can keep building flows from `node`/`edge` directly. Domain-free: every step is a generic node kind, no app or transport assumptions.

## 0.24.0

### Minor Changes

- 15c2db3: FlowGraph becomes a node-based blueprint editor. New `flow-spec` model (`defineFlow` + `node`/`edge` builders → a pure, serializable `FlowDefinition`) and a `flowToGraph` converter, plus a `kind` field on graph nodes. FlowGraph renders blueprint-style cards with a lucide type-icon per node kind, input/output port handles (one output handle per outgoing edge, ordered by target so branches don't cross), and runs as an interactive canvas: drag-to-pan, scroll/buttons zoom, draggable nodes (edges follow), hover/click to focus a node's connections (dimming the rest, click-away to clear), animated connectors, and a vertical layout option. Layout is a dependency-free barycenter pass, computed per connected component and cycle-safe (back-edges are excluded from depth so loops don't run the graph away), with content normalized to the origin. Also: SearchableSelect and ComboBox dropdowns raised above the modal layer (z-index) so they're not hidden inside high-z modals.

## 0.23.0

### Minor Changes

- 30e549a: FlowGraph: add an interactive canvas mode. New `interactive` prop enables drag-to-pan + scroll/buttons-to-zoom (a plain SVG group transform — no canvas library), `animated` makes edges flow as marching dashes toward the arrowhead (honoring prefers-reduced-motion), and `height` sets the canvas viewport. Static mode is unchanged. Node sublabels now render as uppercase kind tags, suiting flow node-kinds (trigger/form/call/effect).

## 0.22.0

### Minor Changes

- f8373ab: Add FlowGraph — a read-only renderer for a declarative directed graph (the static companion to FlowRunner). Domain-free: the host supplies typed nodes/edges and an optional node-select handler. Supports a layered layout (roots→leaves longest-path) and a bipartite split, draws SVG nodes + bezier edges with self-contained CSS, and ships a dependency-free `layoutGraph` util. Powers plugin-connection and role→permission visualizations.

## 0.21.0

### Minor Changes

- e91d4b8: Add generic `BadgeSelect` component (U1 lift).

  A domain-free, inline click-to-edit badge picker generalized from kserp's `RoleBadgeSelect`: renders the selected option as a clickable badge, opens a Portal-anchored popup (escapes `overflow:hidden`, flips above the trigger when space is tight), and auto-shows an inline search once options exceed `searchThreshold` (default 5). The caller injects `options`, the `value`↔`label` mapping, and an optional `badgeClass(value)` tone function; nothing role-specific leaks in. `RoleBadgeSelect` is now expressible as a thin wrapper over it. Purely additive.

## 0.20.0

### Minor Changes

- cfcc27a: Add three spec-driven UI runtimes for the plugin platform (Vision §8/§9/§11):

  - **FileField (U6)** — a declarative file/media field whose value is an opaque asset handle (`{ id, name, mime, size }`). Storage-agnostic: the host injects `onUpload(file) => Promise<handle>` and `presignUrl(handle) => Promise<url>`; ksui models only the pending/uploading/done/failed state machine, drag-drop + click-to-pick, and an image preview that degrades to a broken-thumbnail fallback (never throws) when a presign rejects.
  - **FlowRunner (U7)** — a client renderer for a server-driven node graph. The host injects `advance(state, input) => Promise<nextNode>`; the client only renders UI-effect nodes (form/display/choice/message/terminal) and POSTs each step. All authority/data/branching stays server-side — the client never decides the graph. Ships `utils/flow.ts` with the `FlowNode` discriminated union and pure step helpers.
  - **CustomRenderer + renderer registry (U8)** — a typed, in-process registry mapping a renderer `id` → a component with declared `consumes`/`emits`, plus a `CustomRenderer` that validates props against `consumes` and falls back safely (with a warning) on an unknown id or a mismatch. No `eval`, no remote code — registry holds build-time, in-process components only (supply-chain trust, not a sandbox). Undeclared emits are dropped so a renderer cannot forge an interaction.

  Purely additive; existing exports are unaffected.

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
