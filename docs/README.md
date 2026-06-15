# ksui docs

Live documentation site for `@kahitsan/ksui`. A self contained Vite + SolidJS SPA that renders each component live next to its source, the way the Bootstrap docs do.

This site has its OWN `package.json` and `tsconfig.json`. It is not part of the published package (the package still ships only `src/` and `host-ui.d.ts`) and it is not in the root `tsconfig`, so it never affects the package typecheck or the consumer build.

## How it works

- The real components are imported from `../src` (source, not dist). `vite-plugin-solid` compiles their JSX with the rest of the app, aliased as `@kahitsan/ksui`.
- The host kit specifier `@kserp/host-ui` is aliased to `src/mocks/host-ui.tsx`, a working SolidJS reimplementation of the canonical SDK contract (`../host-ui.d.ts`). So a component's `import { Button } from "@kserp/host-ui"` resolves to the mock with no component edits.
- `solid-js` is deduped so the components and the mock share ONE reactive runtime. A duplicate Solid runtime is the classic cause of dead reactivity.
- Each demo lives in one file under `src/examples/`. A page imports it twice: once as the real module for the live render, once with Vite's `?raw` query for the verbatim source string. The `Example` wrapper renders the live component on top and the same source below, so preview and code can never drift.
- Hash routing (`@solidjs/router` `HashRouter`) sidesteps the GitHub Pages deep link 404; the build also writes a `404.html` fallback.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build      # vite build + the 404.html SPA fallback
npm run preview
```

`VITE_BASE` sets the Pages base path (`/ksui/` in CI; defaults to `/ksui/` locally).

## Add a component

1. Add `src/examples/<name>.tsx` with a `// example-start` marker above the demo (everything above it is stripped from the displayed source).
2. Add `src/pages/<Name>Page.tsx` that imports the example twice (module + `?raw`) and renders it through `Example`.
3. Register the route in `src/index.tsx` and the nav entry in `src/components/Sidebar.tsx`.

## Deploy

`.github/workflows/docs.yml` builds and deploys to GitHub Pages on push to `main` (path filtered to `docs/**`, `src/**`, `host-ui.d.ts`, and the workflow). Set the Pages source to "GitHub Actions" in repo settings once.
