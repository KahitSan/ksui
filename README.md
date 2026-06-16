# @kahitsan/ksui

[![npm version](https://img.shields.io/npm/v/@kahitsan/ksui.svg)](https://www.npmjs.com/package/@kahitsan/ksui)
[![npm downloads](https://img.shields.io/npm/dm/@kahitsan/ksui.svg)](https://www.npmjs.com/package/@kahitsan/ksui)
[![license](https://img.shields.io/npm/l/@kahitsan/ksui.svg)](./LICENSE)

A set of UI components for SolidJS apps, built and used by the KahitSan team.

On npm: [@kahitsan/ksui](https://www.npmjs.com/package/@kahitsan/ksui). Docs:
[ksui.kahitsan.com](https://ksui.kahitsan.com/).

## What this is

`@kahitsan/ksui` is a small library of ready-made user interface pieces for
[SolidJS](https://www.solidjs.com/). SolidJS is a way to build web pages with
reusable components, a bit like React but with its own way of working. These
components are written for SolidJS only. They will not work in React or Vue.

Inside you will find small building-block components, ready-made widgets built
from them, and a few non-visual helpers. The full, always-current list lives in
the docs (see below), so this README stays short on purpose.

## Where you can use it

There are two ways to use KSUI.

1. **In your own SolidJS project.** Install it from npm and use the components
   like any other dependency. It is MIT licensed, so you are free to use it in
   personal or commercial work. See the License section below.
2. **As a contributor to KahitSan plugins.** If you build or help with our
   plugins, these are the shared components you reuse instead of writing your
   own copy.

One honest note so nothing surprises you. Every component is self-contained: the
library depends only on `solid-js` and `lucide-solid` and injects its own CSS, so
there is no host UI kit and no Tailwind to wire up. A handful of components (the
voucher and payment account pickers, the attachment tiles) call a backend that
answers certain requests, so they shine inside an app built the KahitSan way, but
they degrade gracefully without one. Each component page says what it needs.

## What is inside

The package is organized into three kinds of exports:

- **Base components** are the small building blocks, like form fields, status
  pills, tooltips, progress bars, and avatars.
- **Composite components** combine those building blocks into ready-made widgets,
  like the search-and-pick selectors and the notes editor.
- **Utils** are non-visual helpers, like the peso and date formatters and the
  safe link builders.

We do not list every component here on purpose, so this README does not fall out
of date as the set grows. The complete, current catalog, with a live example and
the props for each one, is in the docs:

**https://ksui.kahitsan.com/**

## Install

`@kahitsan/ksui` is on the public npm registry, so no extra registry setup or
login is needed.

```
npm install @kahitsan/ksui
```

You also need a SolidJS app. If you are starting fresh, set one up with
[`vite-plugin-solid`](https://github.com/solidjs/vite-plugin-solid), which is the
tool that compiles Solid components.

## A tiny usage example

```tsx
import { createSignal } from "solid-js";
import { MentionTextarea } from "@kahitsan/ksui";

function NotesField() {
  const [value, setValue] = createSignal("");
  return (
    <MentionTextarea
      value={value()}
      setValue={setValue}
      placeholder="Add notes, type @ to tag a client"
      rows={3}
    />
  );
}
```

The avatar chip is also easy and needs no backend:

```tsx
import { AccountAvatar } from "@kahitsan/ksui";

<AccountAvatar account={{ id: 0, type: "user", name: "Maria Cruz" }} size={32} />;
```

## The honest setup note

One thing this library expects from the app around it:

- **`solid-js` stays external.** This library ships as source, and your own
  `vite-plugin-solid` compiles it. Keep `solid-js` as a single shared copy in
  your app (not bundled twice), so there is only one Solid instance running.

That is the whole setup. There is no host UI kit, no Tailwind, and no app-provided
primitives to wire up — every component injects its own CSS and depends only on
`solid-js` + `lucide-solid`. A few components can do *more* when the surrounding
app feeds them context (a permission check, the active workspace id) through the
optional `configurePermissions` / `configureActiveWorkspace` helpers, but they
degrade gracefully when those are not configured.

Some components (the voucher and payment account pickers, the attachment tiles)
call a backend at paths like `/api/financial-accounts`. The docs site stubs those
calls so you can see every component render with no server.

## Docs

The full documentation site, with a component-by-component guide and setup steps,
will be at:

https://ksui.kahitsan.com/

## Contributing

We welcome help. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for how to set
up the repo, the code style we follow, and how to send a change.

## License

MIT. See [LICENSE](./LICENSE). You are free to use KSUI in your own personal or
commercial SolidJS projects, as long as you keep the MIT license notice. Source
lives at https://github.com/KahitSan/ksui.

---

Created with ♥ by [Luis Edward Miranda](https://github.com/llupRisinglll) for
KahitSan Corp.
