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

export { default as MentionTextarea } from "./components/MentionTextarea";
export type { MentionTextareaProps } from "./components/MentionTextarea";

export { default as MarkdownNotes } from "./components/MarkdownNotes";
export type { MarkdownNotesProps } from "./components/MarkdownNotes";

export { default as ClientPicker } from "./components/ClientPicker";
export type { ClientOption } from "./components/ClientPicker";

export { default as VoucherPicker, calculateDiscount } from "./components/VoucherPicker";
export type { VoucherOption } from "./components/VoucherPicker";

export { default as CameraCapture } from "./components/CameraCapture";

export { default as AddAttachmentTile } from "./components/AddAttachmentTile";

export { default as PaymentAccountPicker } from "./components/PaymentAccountPicker";
export type { PaymentAccountOption } from "./components/PaymentAccountPicker";

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
} from "./components/AccountAvatar";
export type { AvatarAccount } from "./components/AccountAvatar";

export {
  getAccountIcon,
  getAccountTone,
  ACCOUNT_ICON_SLUGS,
  ACCOUNT_ICON_LABELS,
} from "./lib/account-icons";
export type { IconComponent, AccountIconSlug } from "./lib/account-icons";

export { buildLogoSrc } from "./lib/account-logo-url";

export { attachmentUrl, isResolvableAttachment } from "./lib/attachments";

export { default as ExistingAttachmentTile } from "./components/ExistingAttachmentTile";
export type { ExistingAttachment } from "./components/ExistingAttachmentTile";

export { useAccountsIndex, resolveAccount, resolveAccountName } from "./lib/accounts-index";

// Plugin consolidation: widgets/helpers that were duplicated across plugins
// (form fields, detail rows, tooltips, progress/timer/legend display, image
// cropping) promoted into the single canonical package.
export { default as FormField } from "./components/FormField";
export { default as DetailRow } from "./components/DetailRow";
export { INPUT_CLASS } from "./lib/INPUT_CLASS";
export { default as Tooltip } from "./components/Tooltip";
export { default as ImageCropper } from "./components/ImageCropper";
export { default as ProgressBar, type ProgressBarProps } from "./components/ProgressBar";
export { default as LiveTimer, type LiveTimerProps } from "./components/LiveTimer";
export { default as ChartLegend } from "./components/ChartLegend";
