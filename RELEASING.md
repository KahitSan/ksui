# Releasing ksui

Releases are driven by changesets and CI. You do not bump the version or tag by
hand. Here is the whole flow.

## When you make a change

If your change affects the published package (anything under `src/`), add a
changeset with your work:

```
npx changeset
```

Pick the bump type (patch, minor, or major) and write one or two plain sentences
about the change. Commit the generated file in `.changeset/` along with your code.

Docs-only changes (anything under `docs/`) do not need a changeset.

## How a version ships

1. Your change lands on `main` (with its changeset).
2. CI (the Release workflow) sees the pending changeset and opens a pull request
   titled "chore: version packages". That PR bumps the version in `package.json`
   and updates `CHANGELOG.md` from the changesets.
3. When you merge that version PR, CI publishes the new version to the public npm
   registry automatically.

So the version bump is automatic. Your only job is to add a changeset and later
merge the version PR.

## The version dropdown rule

The docs site has a version dropdown in the top bar, read from
`docs/src/versions.ts`. It must stay accurate. When you merge the version PR (the
step that publishes the new version), update `docs/src/versions.ts` in the same
change:

1. Add the new version to the top of the `VERSIONS` array:

   ```ts
   { version: "X.Y.Z", url: "https://github.com/KahitSan/ksui/releases/tag/vX.Y.Z" }
   ```

2. Set `CURRENT_VERSION` to the new version string.

Keep the newest version at the top and keep `CURRENT_VERSION` matching the
version that was just published.

## One-time setup notes

- The repo secret `NPM_TOKEN` must be an npm automation token (2fa bypass) for the
  `kahitsan` org.
- In repo Settings, Actions must be allowed to create and approve pull requests,
  so the version PR can be opened.
