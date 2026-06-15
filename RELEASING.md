# Releasing ksui

This is the short list of steps for shipping a new version. Follow it every time, so the package and the docs site stay in sync.

## Steps

1. Make sure the code on `main` is the code you want to release.
2. Bump the version in `package.json`. Use a normal version bump (patch, minor, or major) that fits the change.
3. Update the changelog so people can see what changed.
4. Update the web documentation so the version dropdown stays accurate (see the rule below). This happens in the same release.
5. Commit, tag the release as `vX.Y.Z`, and publish.
6. Create the matching GitHub release for the tag `vX.Y.Z`.

## The version dropdown rule

The docs site has a version dropdown in the top bar. It reads from `docs/src/versions.ts`. After a new version is released, you must update that file so the dropdown shows the new version. Do this in the same release, not later.

Concretely, in `docs/src/versions.ts`:

1. Add the new version to the top of the `VERSIONS` array. Each entry looks like this:

   ```ts
   { version: "X.Y.Z", url: "https://github.com/KahitSan/ksui/releases/tag/vX.Y.Z" }
   ```

2. Bump `CURRENT_VERSION` to the new version string.

That is it. Keep the newest version at the top of the array, and keep `CURRENT_VERSION` matching the version you just published.
