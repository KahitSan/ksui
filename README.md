# @kahitsan/ksui

The single canonical copy of the shared SolidJS UI components that KahitSan/Hilinga
plugins consume — pickers, the mention textarea, markdown notes, the camera +
attachment tiles, and the data-driven account avatar — plus the `@kserp/host-ui`
ambient type contract for the host UI kit.

Extracted from `kserp/packages/plugin-ui` (`@kahitsan/plugin-ui`) into its own repo
so the UI package versions and publishes independently of the kernel.

## Install

The package is published to **GitHub Packages** under the `@kahitsan` scope. Add an
`.npmrc` so the scope resolves there, then install:

```
# .npmrc
@kahitsan:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```
npm install @kahitsan/ksui
```

## How it ships

This is a SolidJS component library shipped as **source** under a `solid` export
condition (see `package.json`). The consumer's `vite-plugin-solid` compiles the
components, while `solid-js` and `@kserp/host-ui` stay **externalized** to the host
runtime globals — so the component source is bundled into the plugin IIFE exactly
as a local copy would be: one Solid instance, the host UI kit reused. `lucide-solid`
is bundled from the consumer's own deps.

Consumers must keep `solid-js` + `@kserp/host-ui` externalized in their
`vite.remote.config.ts`, and (until a `.d.ts` bundle ships) reference the host kit
types via the `./host-ui` export:

```ts
/// <reference types="@kahitsan/ksui/host-ui" />
```

## Type-checking

`npm run typecheck` runs `tsc --noEmit` standalone (`jsxImportSource: solid-js`, the
shipped `host-ui.d.ts` in scope). The authoritative gate remains each consuming
plugin's own `tsc`, where the plugin's `lucide-solid` and host runtime are present.

## Publishing

Push a `v*` tag (e.g. `v0.3.0`); the release workflow publishes to GitHub Packages.
