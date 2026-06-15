// @kahitsan/ksui: shared SolidJS UI components for KahitSan/Hilinga plugins.
//
// These were copied byte-for-byte across plugins (counter, transactions, ...);
// this package is the single canonical copy, PUBLISHED to GitHub Packages and
// consumed as a normal dependency from `node_modules`: a plugin `npm install`s
// the published version.
// The package ships its source under a `solid` export condition (see
// package.json), so the consumer's vite-plugin-solid compiles these components
// while solid-js and `@kserp/host-ui` stay EXTERNALIZED to the host runtime
// globals. The plugin IIFE bundles them identically to a local copy: no runtime
// change, single Solid instance, host UI kit reused. The `@kserp/host-ui` ambient
// type contract ships alongside (host-ui.d.ts, the `./host-ui` export).
//
// Components live under two folders by category:
//   base/      a primitive that stands on its own. It uses only solid-js,
//              lucide-solid, and/or the host kit via "@kserp/host-ui". It does
//              not import another ksui component.
//   composite/ a component that wraps a base or composes two or more components
//              into a higher-level widget.
// See CONTRIBUTING.md for the placement rule when adding a new component.

// ---------------------------------------------------------------------------
// Base components
// ---------------------------------------------------------------------------

export { default as MentionTextarea } from "./components/base/MentionTextarea";
export type { MentionTextareaProps } from "./components/base/MentionTextarea";

export { default as MarkdownNotes } from "./components/base/MarkdownNotes";
export type { MarkdownNotesProps } from "./components/base/MarkdownNotes";

export { default as ClientPicker } from "./components/base/ClientPicker";
export type { ClientOption } from "./components/base/ClientPicker";

export { default as VoucherPicker, calculateDiscount } from "./components/base/VoucherPicker";
export type { VoucherOption } from "./components/base/VoucherPicker";

export { default as CameraCapture } from "./components/base/CameraCapture";

export { default as AddAttachmentTile } from "./components/base/AddAttachmentTile";

// The canonical account + attachment widget set: AccountAvatar (logo / type-icon
// glyph / initial-on-color fallback, with its initials + color + SVG helpers)
// plus the account icon / logo / tone / accounts-index helpers and the
// ExistingAttachmentTile that completes the attachment trio next to
// AddAttachmentTile + CameraCapture. Plugins import these instead of keeping
// their own local copies.
export {
  default as AccountAvatar,
  getInitials,
  getAvatarColor,
  buildInitialsSvg,
} from "./components/base/AccountAvatar";
export type { AvatarAccount } from "./components/base/AccountAvatar";

export { default as ExistingAttachmentTile } from "./components/base/ExistingAttachmentTile";
export type { ExistingAttachment } from "./components/base/ExistingAttachmentTile";

// Plugin consolidation: widgets that were duplicated across plugins
// (form fields, detail rows, tooltips, progress/legend display, image cropping)
// promoted into the single canonical package.
export { default as FormField } from "./components/base/FormField";
export { default as DetailRow } from "./components/base/DetailRow";
export { default as Tooltip } from "./components/base/Tooltip";
export { default as ImageCropper } from "./components/base/ImageCropper";
export { default as ProgressBar, type ProgressBarProps } from "./components/base/ProgressBar";
export { default as ChartLegend } from "./components/base/ChartLegend";

// ---------------------------------------------------------------------------
// Composite components
// ---------------------------------------------------------------------------

// PaymentAccountPicker composes AccountAvatar inside a searchable dropdown.
export { default as PaymentAccountPicker } from "./components/composite/PaymentAccountPicker";
export type { PaymentAccountOption } from "./components/composite/PaymentAccountPicker";

// LiveTimer wraps ProgressBar with timer state and elapsed-time display.
export { default as LiveTimer, type LiveTimerProps } from "./components/composite/LiveTimer";

// ---------------------------------------------------------------------------
// Utils (not components)
// ---------------------------------------------------------------------------

export {
  getAccountIcon,
  getAccountTone,
  ACCOUNT_ICON_SLUGS,
  ACCOUNT_ICON_LABELS,
} from "./utils/account-icons";
export type { IconComponent, AccountIconSlug } from "./utils/account-icons";

export { buildLogoSrc } from "./utils/account-logo-url";

export { attachmentUrl, isResolvableAttachment } from "./utils/attachments";

export { useAccountsIndex, resolveAccount, resolveAccountName } from "./utils/accounts-index";

export { INPUT_CLASS } from "./utils/INPUT_CLASS";
