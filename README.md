# @kahitsan/ksui

[![npm version](https://img.shields.io/npm/v/@kahitsan/ksui.svg)](https://www.npmjs.com/package/@kahitsan/ksui)
[![npm downloads](https://img.shields.io/npm/dm/@kahitsan/ksui.svg)](https://www.npmjs.com/package/@kahitsan/ksui)
[![license](https://img.shields.io/npm/l/@kahitsan/ksui.svg)](./LICENSE)

A set of UI components for SolidJS apps, built and used by the KahitSan team.

On npm: [@kahitsan/ksui](https://www.npmjs.com/package/@kahitsan/ksui). Docs:
[kahitsan.github.io/ksui](https://kahitsan.github.io/ksui/).

## What this is

`@kahitsan/ksui` is a small library of ready-made user interface pieces for
[SolidJS](https://www.solidjs.com/). SolidJS is a way to build web pages with
reusable components, a bit like React but with its own way of working. These
components are written for SolidJS only. They will not work in React or Vue.

Inside you will find small building-block components, ready-made widgets built
from them, and a few non-visual helpers. The full, always-current list lives in
the docs (see below), so this README stays short on purpose.

## Where you can use it

There are two ways to use ksui.

1. **In your own SolidJS project.** Install it from npm and use the components
   like any other dependency. It is MIT licensed, so you are free to use it in
   personal or commercial work. See the License section below.
2. **As a contributor to KahitSan plugins.** If you build or help with our
   plugins, these are the shared components you reuse instead of writing your
   own copy.

One honest note so nothing surprises you. Some components are self-contained and
work right away. Others, like the client, voucher, and payment account pickers,
expect a backend that answers certain requests, so they fit best inside an app
built the KahitSan way. A few components also expect a small set of shared UI
pieces from your app, like a button and a dialog. The setup note below explains
that part, and each component page says what it needs.

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

**https://kahitsan.github.io/ksui/**

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

Two things this library expects from the app around it:

1. **`solid-js` stays external.** This library ships as source, and your own
   `vite-plugin-solid` compiles it. Keep `solid-js` as a single shared copy in
   your app (not bundled twice), so there is only one Solid instance running.

2. **A host UI kit under the name `@kserp/host-ui`.** Some components import
   shared pieces from your app, like a `Button`, a `confirm` dialog, and a few
   hooks. Your app provides these under the import name `@kserp/host-ui`, and that
   name is kept external at build time too. Components that need it are:
   MarkdownNotes, ClientPicker, CameraCapture, ExistingAttachmentTile, and the
   `useAccountsIndex` hook. The rest do not need it.

So a few components work right away with no backend and no host kit
(MentionTextarea as a plain notes box, AccountAvatar, AddAttachmentTile,
VoucherPicker, and all the helper functions). Others assume the ERP host and a
backend that answers calls like `/api/clients`. The docs site walks through how
to mock the host kit and stub those calls so you can see every component render.

## Docs

The full documentation site, with a component-by-component guide and setup steps,
will be at:

https://kahitsan.github.io/ksui/

## Contributing

We welcome help. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for how to set
up the repo, the code style we follow, and how to send a change.

## License

MIT. See [LICENSE](./LICENSE). You are free to use ksui in your own personal or
commercial SolidJS projects, as long as you keep the MIT license notice. Source
lives at https://github.com/KahitSan/ksui.
