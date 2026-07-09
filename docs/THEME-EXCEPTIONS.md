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
- FlowGraph/FlowRunner: **not yet exempted.** A first pass at both files
  (grepped 2026-07-09) shows their literals are mostly per-STATUS coloring
  (`.ksui-fg-edge.info` / `.success` / `.danger` / `.muted`) — that's rule 3
  semantic-intent territory (`--ks-info`/`--ks-success`/`--ks-danger` +
  neutral), not a data-viz palette, and gets tokenized like any other status
  color. Only a genuinely distinct-per-node-KIND hue table (if one exists
  once the status-colored rules are converted) earns a line-range entry here
  — add it with the specific line range once that audit is done, during the
  actual conversion pass, not as a blanket file exemption now.
- Pure-transparency utilities (`transparent`, `currentColor`) are never
  flagged — they carry no color of their own to derive from a token.
- Truly-fixed data-viz series hues that don't map to the `--ks-chart-1..N`
  fixed-order categorical tokens (§1.2) — prefer the chart tokens first; only
  list an entry here if a series genuinely can't use them (e.g. it must match
  an external system's fixed brand color).

## Entries requiring per-literal justification when added

Every new entry must state, in this file, WHY the literal can't be a token —
"not done yet" is not a reason. If in doubt, it's not an exception: pick the
closest-role token per §1.2 and wrap the literal as its fallback.
