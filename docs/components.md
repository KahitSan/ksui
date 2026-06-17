# ksui component reference

This is the per-component guide for `@kahitsan/ksui`. It is a set of UI components built with SolidJS. We (the KahitSan team) first built them for our own projects, including our ERP product called Hilinga. ("ERP" means a business system for things like sales, clients, and money.) We are sharing them so you can use them too.

A quick honest note before you start: this library grew out of an internal ERP. Every component depends only on the `solid-js` package (plus `lucide-solid` for icons) and injects its own CSS — there is no host UI kit to wire up; the library ships its own `Button`, `Modal`, `confirm`, and string match helpers. A few components are ERP-specific, which means they assume our ERP backend and ask it for data over the network. Those degrade gracefully to an empty or "could not load" state without a backend. We will tell you, component by component, what each one needs.

To use any of these you need a SolidJS app with `vite-plugin-solid` set up. Install the package from npm:

```bash
npm install @kahitsan/ksui
```

How to read the two groups below:

- **General components** do not assume our ERP. They depend only on `solid-js` and are not tied to ERP data like clients or accounts.
- **ERP components** assume our ERP host. Many of them fetch data from ERP backend routes (like `/api/clients`). Outside our ERP they will show an empty or "could not load" state, which is safe but means you need our backend, or a stubbed one, to see real data.

In every code example below, `createSignal` comes from `solid-js`. A "signal" is just SolidJS's way of holding a value that can change and update the screen.

---

## General components

These do not assume our ERP. They depend only on `solid-js`.

### CameraCapture

A full-screen pop-up (a "modal") that opens the device camera. You can take a photo, look at it, retake it if you want, and confirm. When you confirm, it hands the photo back to you as a `File` object. This is handy for snapping a receipt or a document.

**When to use it:** when you want the user to take a photo with their camera and give you the resulting file, for example to upload a receipt.

**What it needs:** nothing beyond `solid-js` — it uses ksui's own `Button` and injects its own CSS. In a page with no camera permission it lands in an error state and shows a "Could not access camera" message plus a Close button, which still renders fine. It also uses a `card-bg` CSS class for styling.

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `onCapture` | `(file: File) => void` | Yes | Called with the captured photo as a `File` when the user confirms it. |
| `onClose` | `() => void` | Yes | Called when the modal is closed, or when the camera fails. |

```tsx
<Show when={cameraOpen()}>
  <CameraCapture onCapture={(file) => upload(file)} onClose={() => setCameraOpen(false)} />
</Show>
```

### AddAttachmentTile

A dashed square "Add" tile. When you tap it, a small menu opens with two choices: take a photo with the camera, or pick an image or file from the device. While a file is being sent, it shows an "Uploading" label instead.

**When to use it:** as the "add a file" button in a row of attachment tiles, where the user can either snap a photo or browse for a file.

**What it needs:** nothing beyond `solid-js`. Just pass the three props. It uses a custom CSS class called `ks-hud-clip-top-left-bottom-right` to give it angled, clipped corners. It still renders without that class, just with plain square corners.

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `uploading` | `boolean` | Yes | When true, the tile is disabled and shows "Uploading" instead of "Add". |
| `onPickFile` | `() => void` | Yes | Called when the user chooses "Image or file". |
| `onPickCamera` | `() => void` | Yes | Called when the user chooses "Camera". |

```tsx
<AddAttachmentTile uploading={false} onPickFile={openFileDialog} onPickCamera={() => setCameraOpen(true)} />
```

### ExistingAttachmentTile

Shows one file that is already uploaded, as a small tile. If the file is an image, it shows a preview. If it is not an image, it shows a paperclip and the file name, and the tile links to the file. If the file link is broken, it shows an "Unavailable" placeholder. You can also turn on a remove button, which asks the user to confirm before deleting.

**When to use it:** to display files that are already saved, for example the attachments already on a record, with an optional way to remove one.

**What it needs:** nothing beyond `solid-js` — it uses ksui's built-in `confirm` dialog to ask before removing. The remove button only appears when you pass `onDelete`. To show an image preview, give it an attachment with an `https` link and an `image/*` mime type. With a missing or non-`http` link it shows the "Unavailable" placeholder.

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `attachment` | `ExistingAttachment` | Yes | The file to show. Fields: `id`, `file_name`, `mime_type`, `s3_link` (the public URL or `null`). |
| `testId` | `string` | Yes | A `data-testid` value for the tile, used in tests. |
| `onDelete` | `(attachmentId: number) => Promise<void> \| void` | No | If given, a remove button appears. This runs after the user confirms removal. |
| `fallbackIcon` | `Component<{ size?: number }>` | No | Icon shown for non-image files. The default is a paperclip. |

```tsx
<ExistingAttachmentTile
  attachment={{ id: 1, file_name: "receipt.jpg", mime_type: "image/jpeg", s3_link: "https://cdn.example.com/r.jpg" }}
  testId="att-1"
  onDelete={remove}
/>
```

### buildLogoSrc

A tiny safety helper, not a visual component. You give it a stored logo link and it returns that link only if it is an `http` or `https` URL. Otherwise it returns an empty string. This blocks unsafe links, like ones starting with `javascript:`, from ever reaching an image tag.

**When to use it:** any time you put a logo or image URL that came from stored data into an `<img src>`, so a bad link cannot sneak in.

**What it needs:** nothing. It is a plain function.

| Function | Type | Required | What it does |
| --- | --- | --- | --- |
| `buildLogoSrc(s3Link)` | `(s3Link: string \| null \| undefined) => string` | Yes | Returns the URL if it is a safe `http(s)` link, otherwise an empty string. |

```tsx
<img src={buildLogoSrc(account.s3_link)} alt="" />
```

### attachmentUrl and isResolvableAttachment

Two small safety helpers for attachment links, not visual components. `attachmentUrl` returns the link only if it is an `http(s)` URL, otherwise an empty string. `isResolvableAttachment` returns true or false for whether the link can actually be opened. Together they stop unsafe links from being used.

**When to use them:** when you have a stored attachment link and want to decide if it is safe to open, and to build a safe `href` for it.

**What they need:** nothing. They are plain functions.

| Function | Type | Required | What it does |
| --- | --- | --- | --- |
| `attachmentUrl(s3Link)` | `(s3Link: string \| null \| undefined) => string` | Yes | Returns a safe `http(s)` URL, or an empty string. |
| `isResolvableAttachment(s3Link)` | `(s3Link: string \| null \| undefined) => boolean` | Yes | True only when the link is a safe `http(s)` URL. |

```tsx
const ok = isResolvableAttachment(att.s3_link);
const href = attachmentUrl(att.s3_link);
```

### DatePicker

A calendar date picker. It shows a small trigger button labeled with the chosen date (or "Pick date" when empty); clicking it opens a calendar pop-up with month navigation, a natural-language text box (you can type "dec 3", "yesterday", or "last week"), quick shortcuts, and a day grid. It works in two shapes: a **single date** (the value is an ISO `YYYY-MM-DD` string, or `null`), or a **range** when you pass `range` (the value is a `DateRangeValue` `{ start, end }` pair). There is also an optional time field (`withTime`) for single-date mode. This is the same picker the `DataTable` date filter uses.

**When to use it:** any time you want the user to pick a day (or a start/end range) without fighting the browser's native date input.

**What it needs:** nothing beyond `solid-js` — it injects its own dark CSS (sharing the DataTable's `--ksui-dt-*` palette so a retint covers both) and uses `lucide-solid` icons.

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `value` | `string \| null` (single) or `DateRangeValue` (range) | Yes | The selected date, or the `{ start, end }` pair in range mode. |
| `onChange` | `(date: string \| null) => void` (single) or `(range: DateRangeValue) => void` (range) | Yes | Called with the new value whenever the user picks. |
| `range` | `true` | No | Switches the picker to range mode; `value` / `onChange` then use `DateRangeValue`. |
| `placeholder` | `string` | No | Trigger label when no date is set (default "Pick date"). |
| `withTime` | `boolean` | No | Show a time field (single-date mode only). |
| `disabled` | `boolean` | No | Disable the trigger. |

```tsx
const [day, setDay] = createSignal<string | null>(null);
<DatePicker value={day()} onChange={setDay} placeholder="Pick date" />

const [range, setRange] = createSignal<DateRangeValue>({ start: null, end: null });
<DatePicker range value={range()} onChange={setRange} />
```

### DataTable

A data table with search, column sorting, and pagination built in. It runs in two modes. In **client-side mode** you hand it a `data` array and it does the search, sort, and paging in the browser. In **server-side mode** you give it a `fetchFn` that returns `{ data, total }`, and the table calls it with the current page, search text, sort, and date filter — so the heavy lifting stays on your backend. It also has an optional `filters` slot for your own filter buttons, an optional date filter (`dateField`), a "Show more" load mode (`loadMore`), per-row expansion panels, and an `onRefetch` handle so a parent can refetch on demand.

**When to use it:** any list of records that needs search, sorting, and pages. Reach for client-side mode for a small in-memory list, and server-side mode when the data lives behind an API and you want the server to page and filter it.

**What it needs:** nothing beyond `solid-js` for client-side mode — it injects its own dark CSS and uses `lucide-solid` icons. Server-side mode needs you to supply a `fetchFn`; the table itself is backend-agnostic.

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `columns` | `DataTableColumn<T>[]` | No | The columns to draw. Each has a `data` key (or `null` for an action column), an optional `title`, an optional `render`, and `orderable` / `className`. |
| `data` | `T[]` | No | Static rows for client-side mode. Ignored when `fetchFn` is set. |
| `fetchFn` | `(p: FetchParams) => Promise<FetchResult<T>>` | No | Server-side fetcher. When present, the table runs server-side and calls this with `{ page, limit, search, sortBy, sortDir, dateFilter, dateFrom, dateTo }`. |
| `refetchKey` | `() => unknown` | No | Reactive key; when it changes the table resets to page 1 and refetches. |
| `onRefetch` | `(api: { refetch; resetAndRefetch }) => void` | No | Hands the parent a refetch handle. |
| `filters` | `JSX.Element` | No | Your own filter UI, rendered in the header bar (a dropdown on mobile). |
| `searchPlaceholder` / `emptyMessage` / `noResultsMessage` | `string` | No | Copy for the search box and the empty / no-results states. |

```tsx
<DataTable<Person>
  data={people}
  columns={[{ data: "name", title: "Name" }, { data: "role", title: "Role" }]}
  pageLength={10}
  searchPlaceholder="Search people…"
/>
```

---

## ERP components

These assume our ERP host. Many of them ask our ERP backend for data over the network. Outside our ERP, or without a stubbed backend, they show an empty or "could not load" state, which is safe but means you will not see real data.

### MentionTextarea

A text box where you can type notes and tag a client by typing the `@` sign. ("Client" here means a customer in our ERP.) When you type `@`, a small dropdown of clients appears for you to pick from, and the one you pick shows up as a colored chip inside the text. The actual text value you get back is a token string like `@[Name](client:5)`, so the tag is stored in a stable way, not just as plain words.

**When to use it:** when you want a notes field where the user can mention specific clients, and you want those mentions saved as tokens you can resolve later.

**What it needs:** nothing beyond `solid-js`. To show the empty box you only need `value`, `setValue`, and a placeholder. The `@` dropdown calls `fetch('/api/clients')`. With no backend that fetch just fails and the popup shows "no results", so the box still works as a plain notes editor. To show real client results, your app must serve `/api/clients`.

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `value` | `string` | Yes | The current text, in the token format the box reads and writes. |
| `setValue` | `(next: string) => void` | Yes | Called with the new text every time the user edits. |
| `placeholder` | `string` | No | Grey hint text shown when the box is empty. |
| `rows` | `number` | No | How many lines tall the box starts (1 to 12, default 2). |
| `class` | `string` | No | Extra CSS classes for the editable area. |
| `ariaLabel` | `string` | No | Accessibility label for screen readers. |
| `disabled` | `boolean` | No | When true, the box is read-only and cannot be focused. |
| `onBlur` | `() => void` | No | Called when the box loses focus. |

```tsx
const [v, setV] = createSignal("");
<MentionTextarea value={v()} setValue={setV} placeholder="Add notes, type @ to tag a client" rows={3} />
```

### MarkdownNotes

Takes a notes string written in a small subset of markdown (bold, italic, code, links, bullet lists, and numbered lists) plus client-mention tokens, and shows it as read-only formatted text. ("Markdown" is a simple way to write formatted text with plain symbols, like `**bold**`.) Mentioned clients become chips. If the user is allowed to view clients, hovering a chip shows a card with that client's contact details.

**When to use it:** to display notes that were typed in `MentionTextarea`, so the mentions and the markdown formatting both render nicely and read-only.

**What it needs:** nothing beyond `solid-js` — `highlightMatch` is built in. Permission gating is optional: wire up ksui's `configurePermissions` integration to control the hover card, otherwise it degrades to mention chips shown as plain links and no hover card. The hover card calls `fetch('/api/clients/:id')`. With no backend the chip just stays plain.

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `value` | `string \| null \| undefined` | Yes | The notes text to render. Empty or missing renders nothing. |
| `class` | `string` | No | Extra CSS classes for the wrapper element. |
| `searchQuery` | `string` | No | When set, matching words in the text are highlighted using the host's `highlightMatch` helper. |

```tsx
<MarkdownNotes value={"Paid by @[Acme](client:7)\n\n- **deposit** received"} />
```

### ClientPicker

A button that opens a search popup so you can pick one client. You type to search, results come from the clients part of our ERP, and you can also create a brand new client right from the search box if there is no exact match. If the clients feature is missing, the popup shows a friendly "could not load" notice.

**When to use it:** when a form needs the user to choose a client (or leave it as a walk-in with no client), with the option to create a new client on the spot.

**What it needs:** nothing beyond `solid-js` — `highlightMatch` is built in. The closed button renders fine with just `selected` and `onChange`. Search and create call `fetch('/api/clients')`. With no backend it shows the "could not load" state. To show live results, your app must serve `/api/clients`.

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `selected` | `ClientOption \| null` | Yes | The currently chosen client, or `null` for a walk-in. |
| `onChange` | `(next: ClientOption \| null) => void` | Yes | Called with the new client, or `null` when cleared. |
| `onCreate` | `(created: ClientOption) => void` | No | Called when a new client is created from the search box. |
| `disabled` | `boolean` | No | When true, the trigger button is disabled. |
| `defaultOpen` | `boolean` | No | When true, the popup opens automatically when the component mounts. |

```tsx
const [client, setClient] = createSignal<ClientOption | null>(null);
<ClientPicker selected={client()} onChange={setClient} />
```

### VoucherPicker

A button that opens a popup so you can pick a discount voucher for a sale. ("Voucher" here means a discount coupon.) It loads vouchers from the vouchers part of our ERP, splits them into ones that apply to the current cart and ones that do not, and shows the peso discount each one gives. It also exports a helper called `calculateDiscount` that works out the discount amount for a voucher and a subtotal.

**When to use it:** on a sale or checkout screen where the user can apply a discount voucher and you want to preview how much it takes off.

**What it needs:** nothing beyond `solid-js`. The closed button renders with `selected`, `onChange`, `subtotal`, and `packageIds`. Opening it calls `fetch('/api/vouchers')`. With no backend it shows the "could not load" state. The `calculateDiscount` helper is a plain function and needs nothing.

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `selected` | `VoucherOption \| null` | Yes | The currently chosen voucher, or `null` for none. |
| `onChange` | `(next: VoucherOption \| null) => void` | Yes | Called with the chosen voucher, or `null` when removed. |
| `subtotal` | `number` | Yes | The cart subtotal. Used to decide which vouchers apply and to preview the discount. |
| `packageIds` | `number[]` | Yes | The package ids in the cart. Used to check vouchers that are limited to certain packages. |
| `disabled` | `boolean` | No | When true, the trigger button is disabled. |
| `compact` | `boolean` | No | When true, the trigger renders inline and smaller instead of full width. |

```tsx
const [v, setV] = createSignal<VoucherOption | null>(null);
<VoucherPicker selected={v()} onChange={setV} subtotal={1000} packageIds={[]} />
```

### PaymentAccountPicker

A button that opens a popup so you can choose which financial account a payment goes into. ("Financial account" means a place money lands, like cash, an e-wallet, a bank, or an external account.) It loads the accounts you can access, groups them by type, auto-picks the first one, and reports how many accounts loaded so the parent screen can disable charging when there are none.

**When to use it:** on a payment screen where the user must say which account receives the money, and you want to block charging when no account is available.

**What it needs:** nothing beyond `solid-js`; the `AccountAvatar` it draws is self-contained too. It fetches `/api/financial-accounts` when it mounts. With no backend it shows "No accessible accounts", which renders fine. To show real accounts, your app must serve `/api/financial-accounts`.

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `selected` | `PaymentAccountOption \| null` | Yes | The currently chosen account, or `null`. |
| `onChange` | `(next: PaymentAccountOption \| null) => void` | Yes | Called with the chosen account. |
| `onCountChange` | `(count: number) => void` | No | Reports how many accounts loaded, so the parent can gate the Charge action. |
| `disabled` | `boolean` | No | When true, the trigger button is disabled. |

```tsx
const [acct, setAcct] = createSignal<PaymentAccountOption | null>(null);
<PaymentAccountPicker selected={acct()} onChange={setAcct} onCountChange={(n) => setHasAccounts(n > 0)} />
```

### AccountAvatar

A small square or round chip that pictures an account or a person. For a financial account, it shows the uploaded logo, or a chosen icon, in a rounded square. For a user, it shows the profile photo, or a circle with their initials on a color. It also exports helper functions: `getInitials`, `getAvatarColor`, and `buildInitialsSvg`, which let you build those initials and colors yourself.

**When to use it:** anywhere you want a consistent little picture for an account or a person, for example next to an account name or a payment row.

**What it needs:** nothing beyond `solid-js`. Just pass an account object. Logo and photo URLs only render if they start with `http` or `https` (a safety filter), so use a real `https` image URL to show a logo.

| Prop | Type | Required | What it does |
| --- | --- | --- | --- |
| `account` | `AvatarAccount` | Yes | The record to draw. Fields: `id`, `type`, optional `s3_link` (logo URL), `icon` (slug), `color`, `name`, `image` (user photo). |
| `size` | `number` | No | Pixel width and height of the chip (default 28). |
| `class` | `string` | No | Extra CSS classes on the wrapper. |
| `iconClass` | `string` | No | CSS classes for the fallback icon glyph (default `text-zinc-300`). |
| `alt` | `string` | No | Alt text for the image. |
| `variant` | `'account' \| 'user'` | No | Force account or user rendering. Defaults to `'user'` when `account.type` is `'user'`, otherwise `'account'`. |

```tsx
<AccountAvatar account={{ id: 0, type: "user", name: "Maria Cruz" }} size={32} />
```

### getAccountIcon and getAccountTone

A set of helpers for financial-account icons and colors, not visual components. `getAccountIcon` picks the right icon for an account, using its chosen icon slug or a type-based default. ("Slug" here means a short text id for the icon, like `landmark`.) `getAccountTone` gives the accent text, background, and border colors for an account chip. The exports `ACCOUNT_ICON_SLUGS` and `ACCOUNT_ICON_LABELS` are the list of icon choices and their friendly names, handy for building an icon picker.

**When to use them:** when you are drawing your own account chip or building an icon picker, and you want the same icons and colors our ERP uses.

**What they need:** nothing. They are plain helpers. `getAccountIcon` returns an icon component you render with SolidJS's `<Dynamic>` or directly.

| Function | Type | Required | What it does |
| --- | --- | --- | --- |
| `getAccountIcon(account)` | `(account: { icon?: string \| null; type: string }) => IconComponent` | Yes | Returns the icon component to render for the account. |
| `getAccountTone(account)` | `(account: { color?: string \| null; type: string }) => { class?: string; style?: JSX.CSSProperties }` | Yes | Returns accent styling, either CSS classes or inline color styles. |
| `ACCOUNT_ICON_SLUGS` | `readonly string[]` | No | The list of valid icon slug values. |
| `ACCOUNT_ICON_LABELS` | `Record<AccountIconSlug, string>` | No | A friendly label for each icon slug, for building a picker. |

```tsx
const Icon = getAccountIcon({ type: "bank", icon: "landmark" });
<Dynamic component={Icon} size={20} />
```

### useAccountsIndex, resolveAccount, and resolveAccountName

A data helper for looking up financial accounts by id, not a visual component. `useAccountsIndex` loads all accounts once for the active workspace and keeps them in a shared in-memory map. ("Workspace" here means the org or company you are currently working in.) `resolveAccount` turns an id into a drawable account object you can pass to `AccountAvatar`, and `resolveAccountName` turns an id into the account's display name.

**When to use it:** when you have account ids on records (like a payment's `financial_account_id`) and you want to show the account's avatar or name without fetching each one separately.

**What it needs:** `useAccountsIndex` reads the active workspace from ksui's optional `configureActiveWorkspace` integration and fetches `/api/financial-accounts`, so it needs our backend at run time (without `configureActiveWorkspace` wired up it degrades to an empty workspace). It is a live-data hook, not a render-only piece. The pure helpers `resolveAccount` and `resolveAccountName` are easy: just pass a plain `{ byId, nameById }` object (or `undefined`) and an id, with no setup.

| Function | Type | Required | What it does |
| --- | --- | --- | --- |
| `useAccountsIndex()` | `() => Resource<{ byId: Map; nameById: Map }>` | Yes | Returns a SolidJS resource holding the loaded account index. |
| `resolveAccount(index, id)` | `(index, id) => AvatarAccount \| null` | Yes | Returns an `AvatarAccount` for the id, or a generic placeholder, or `null`. |
| `resolveAccountName(index, id)` | `(index, id) => string \| null` | Yes | Returns the account's display name for the id, or `null`. |

```tsx
const accounts = useAccountsIndex();
const acct = resolveAccount(accounts(), payment.financial_account_id);
<Show when={acct}>{(a) => <AccountAvatar account={a()} />}</Show>
```
