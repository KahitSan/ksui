# Changesets

This folder holds changesets. A changeset is a small note that says what changed
and how the version should bump (patch, minor, or major).

When you make a change that affects the published package, add one:

```
npx changeset
```

Pick the bump type and write one or two plain sentences about the change. Commit
the generated file with your work. You do not bump the version yourself: when
your change lands on `main`, CI opens a "version packages" pull request that
applies all pending changesets, and merging that pull request publishes the new
version to npm.

Docs-only changes (anything under `docs/`) do not need a changeset, since the
published package does not include the docs site.
