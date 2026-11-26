---
"@kahitsan/ksui": minor
---

Port to Solid 2 (prerelease on the `solid2` tag; `latest` stays on Solid 1). Requires `solid-js` and `@solidjs/web` `^2.0.0`.

- `createResource`-based helpers now return a `FetchResource<T>`: an accessor with `.loading` and `.error`.
- ARIA state props are strings (`"true"`/`"false"`), via the new `ariaBool` helper.
- `classList` is gone; use `class` with an array or object.
- `onMount` became `onSettled`, `Suspense` became `Loading`, and `useTopLayer` no longer needs an `onCleanup` wrapper.
- `merge` no longer skips explicit `undefined`; `Button` keeps its defaults when a wrapper forwards `undefined`.
- `usePopoverMount` returns `() => HTMLElement`.
