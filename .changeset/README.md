# Changesets

This folder is where pending **changesets** live until a release ships them.

A changeset is a small markdown file that describes one user-visible change
plus the kind of version bump it needs (`patch`, `minor`, `major`). Releases
auto-bump `package.json`, rewrite `CHANGELOG.md`, and tag the new version
from these files.

## Adding one

```bash
npx changeset
```

The interactive prompt asks for the bump type and a short description.
Commit the resulting `.changeset/<random>.md` file alongside your code
change.

## Writing a good description

Write it for the next developer reading the changelog three months from
now, not for yourself today. One or two sentences. Say what changed, not
how.

- "Add bulk-import for clients via CSV." ✓
- "Refactor importer." ✗

## Bump type rule of thumb

- `patch` — bug fix or internal change that doesn't break callers.
- `minor` — new user-visible feature, backwards-compatible.
- `major` — breaking change (route renamed, field removed, etc.).
