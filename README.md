# @kahitsan/ksui

A set of UI components for SolidJS apps, built and used by the KahitSan team.

## What this is

`@kahitsan/ksui` is a small library of ready-made user interface pieces for
[SolidJS](https://www.solidjs.com/). SolidJS is a way to build web pages with
reusable components, a bit like React but with its own way of working. These
components are written for SolidJS only. They will not work in React or Vue.

Inside you will find things like a notes box where you can tag a client with the
`@` sign, picker buttons for clients, vouchers and payment accounts, a camera
capture screen, small file attachment tiles, and a square avatar chip for a
financial account or a person. There are also some tiny helper functions for
icons, colors, and safe links.

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

Components:

- **MentionTextarea** is a notes box. Type `@` to tag a client from a dropdown.
  The picked client shows as a colored chip.
- **MarkdownNotes** shows notes text (with bold, italic, links, lists, and
  client tags) as read-only formatted text.
- **ClientPicker** is a button that opens a search popup to pick one client. You
  can also create a new client right from the search box.
- **VoucherPicker** is a button to pick a discount voucher for a sale. It also
  exports a `calculateDiscount` helper.
- **CameraCapture** is a full-screen view that opens the device camera, lets you
  take a photo, review or retake it, and hands back a file.
- **AddAttachmentTile** is a dashed "Add" tile. Tapping it lets you take a photo
  or pick a file from the device.
- **ExistingAttachmentTile** shows one already-uploaded file as a small tile,
  with an image preview or a file link, plus an optional remove button.
- **PaymentAccountPicker** is a button to choose which financial account a payment
  goes into, grouped by type (cash, e-wallet, bank, external).
- **AccountAvatar** is a small square or round chip picturing an account (logo or
  icon) or a person (photo or initials).

Helper functions:

- **getAccountIcon / getAccountTone** pick the right icon and accent colors for
  a financial account. Comes with `ACCOUNT_ICON_SLUGS` and `ACCOUNT_ICON_LABELS`
  for building an icon picker.
- **buildLogoSrc** returns a logo link only if it is a safe `http`/`https` URL,
  else an empty string.
- **attachmentUrl / isResolvableAttachment** are small safety helpers for
  attachment links.
- **useAccountsIndex / resolveAccount / resolveAccountName** load financial
  accounts once and look them up by id.

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
