# Theme exceptions

Wave A left ~886 hex/rgba + ~192 Tailwind-palette literals untokenized on the
theory that some had "no exact token match." That theory is retired (THEME-SPEC
§6a Wave A.2 addendum, manager directive): every literal gets a token — alpha
variants become `color-mix(...)` on the token's base, plain Tailwind palette
classes become arbitrary-value `var()` forms, and semantic intents (Button,
StatusPill/StatusIndicator/Dropdown, form error/valid states) become the
matching `--ks-success`/`--ks-warning`/`--ks-danger`/`--ks-info` family.

`npm run check:coverage` fails the build on any bare literal in
`src/components` or `src/utils` that isn't listed below. An entry here is a
claim that the literal is not a themeable surface color — not a place to park
work that's merely unfinished.

## Format

- Whole-file exception: `` `src/components/composite/File.tsx` `` — reason.
- Line-range exception: `` `src/components/composite/File.tsx:33` `` or
  `` `src/components/composite/File.tsx:40-58` `` — reason.

Both forms parse as backtick-quoted paths in this file — `check:coverage`
reads them directly, so keep entries backtick-quoted or they won't be
recognized as exclusions.

## Known-legitimate exceptions

- `src/components/base/AccountAvatar.tsx:33-35` — 15-color deterministic
  hash-to-color palette for avatar initials; needs to stay visually distinct
  per-user regardless of theme, not follow a themeable surface role. Only the
  palette array itself is exempt — the rest of the file's surface/text
  literals (e.g. the `text-zinc-300` fallback-initial styling) still need
  tokens.
- `src/components/base/DatePicker.tsx:134` — the toggle-switch knob is
  intentionally solid white (`background:#ffffff`) regardless of theme, like
  a native OS switch: it must read against both the off-track
  (`--ks-border-strong`) and on-track (`--ks-primary`, color-mixed) colors in
  both light and dark themes. Wrapping it in a text/fg token (e.g. `--ks-fg`)
  would turn it near-black in the light theme and make it disappear against
  the light-mode track — a real regression, not a styling preference.
- FlowGraph/FlowRunner: **no exception needed.** Re-audited 2026-07-09 after
  a live-DOM light-theme regression report — the earlier "no exception
  needed" entry here was itself too broad: it had signed off two rules that
  still carried a bare `rgba(255,255,255,…)` fallback outside the `--ks-fg`
  chain (`.ksui-fg-card`'s border and the SVG arrowhead marker's `fill`
  attribute — the marker in particular sits inside `<defs>` on a `<path>`,
  not a CSS class rule, so it was invisible to a class-name-based audit),
  which rendered white-on-near-white on a light page. Both now read
  `var(--ksui-fg-edge/-node-border, color-mix(in srgb, var(--ks-fg, #ffffff)
  N%, transparent))`, matching every other rule in the file. Every remaining
  literal is per-STATUS coloring (`.ksui-fg-edge.info` / `.success` /
  `.danger` / `.muted`, plus the matching `.ksui-fg-card.*` border/chip
  pairs) or a neutral canvas/border/text tone derived from
  `--ks-fg`/`--ks-bg`/`--ks-surface-raised`. `KIND_ICON` maps kind to a
  lucide glyph only, never a color — there is no distinct-per-node-KIND hue
  table in either file.
- Pure-transparency utilities (`transparent`, `currentColor`) are never
  flagged — they carry no color of their own to derive from a token.
- Truly-fixed data-viz series hues that don't map to the `--ks-chart-1..N`
  fixed-order categorical tokens (§1.2) — prefer the chart tokens first; only
  list an entry here if a series genuinely can't use them (e.g. it must match
  an external system's fixed brand color).

- `src/components/base/ThemeToggle.tsx:24` — thumb box-shadow
  `0 1px 3px rgba(0,0,0,0.3)` doesn't match any `--ks-shadow-*` token as a
  whole value (rule 5); the bg-color on this same line is tokenized.
- `src/components/base/ThemeToggle.tsx:25` — active-thumb box-shadow
  `0 1px 3px rgba(0,0,0,0.15)` doesn't match any `--ks-shadow-*` token as a
  whole value (rule 5); the bg-color on this same line is tokenized.
- `src/components/base/StatusIndicator.tsx:17-43` — the five per-tone
  `glow` box-shadow values (`shadow-[0_0_10px_rgba(...)]`) are colored glow
  effects keyed to each tone's hue at a fixed alpha; none matches a whole
  `--ks-shadow-*` token (those are neutral black elevation shadows), so rule
  5 keeps them literal. The `dot`/`text` colors in the same table are
  tokenized.
- `src/components/base/ImageViewer.tsx:29-31` — the fullscreen image's own
  box-shadow and the close-button's translucent-white background/hover are
  chrome that sits on top of the displayed photo itself (not an app
  surface), documented in the file's own header comment; converting them to
  theme tokens would make the close button fade against a light theme's
  photo-viewer backdrop instead of staying a fixed overlay control.
- `src/components/base/DataTable.tsx:101-111` — the card + filter-menu
  neutral elevation shadows (`0 1px 2px rgba(0,0,0,0.3)`, `0 8px 20px -10px
  rgba(0,0,0,0.5)`, `0 20px 25px -5px rgba(0,0,0,0.4)`, `0 8px 10px -6px
  rgba(0,0,0,0.4)`) don't match any `--ks-shadow-*` token as a whole value
  (rule 5); every surface/border/text color feeding these rules is already
  tokenized.
- `src/components/base/Modal.tsx:48-50` — the dialog/sheet card box-shadow
  (`0 25px 50px -12px rgba(0,0,0,0.6)`, both the sheet and dialog variants)
  doesn't match any `--ks-shadow-*` token as a whole value (rule 5); the
  backdrop scrim on the same block is tokenized (`--ks-overlay`).
- `src/components/base/DatePicker.tsx:93` — the popover's elevation shadow
  (`0 25px 50px -12px rgba(0,0,0,0.5)`) doesn't match any `--ks-shadow-*`
  token as a whole value (rule 5); every surface/border color on the same
  rule is tokenized.

- `src/components/composite/FlowGraph.test.tsx` — this is the regression
  test that asserts the marker `fill` attribute and injected `.ksui-fg-card`
  CSS never regress to a bare `rgba(255,255,255,…)` literal; its comments
  and `not.toMatch(/rgba\(…/)` regex literals name the forbidden pattern in
  order to check its *absence*, which the coverage scanner's substring match
  can't distinguish from an actual applied color.

## Entries requiring per-literal justification when added

Every new entry must state, in this file, WHY the literal can't be a token —
"not done yet" is not a reason. If in doubt, it's not an exception: pick the
closest-role token per §1.2 and wrap the literal as its fallback.
