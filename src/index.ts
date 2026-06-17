// @kahitsan/ksui: a standalone SolidJS UI component library.
//
// Published to the public npm registry and consumed as a normal dependency. The
// package ships its source under a `solid` export condition (see package.json),
// so the consumer's vite-plugin-solid compiles these components while solid-js
// stays EXTERNALIZED to the app's runtime so there is a single Solid instance.
// The library is self-contained: it depends only on solid-js + lucide-solid and
// injects its own CSS at runtime — no host UI kit, no Tailwind, no app-provided
// primitives are required. Components that can integrate with a surrounding app
// (a permission check, the active workspace) do so through an OPTIONAL opt-in
// registry (configurePermissions / configureActiveWorkspace) and degrade
// gracefully when it is not configured.
//
// Components live under two folders by category:
//   base/      a primitive that stands on its own. It uses only solid-js and
//              lucide-solid (plus ksui's own utils). It does not import another
//              ksui component.
//   composite/ a component that wraps a base or composes two or more components
//              into a higher-level widget.
// See CONTRIBUTING.md for the placement rule when adding a new component.

// ---------------------------------------------------------------------------
// Base components
// ---------------------------------------------------------------------------

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

// Plugin reusability backlog: atoms migrated from per-plugin copies into the
// single canonical package.
export { default as StatusPill, type StatusTone } from "./components/base/StatusPill";
export { default as SegmentedFilter, type SegmentedFilterOption } from "./components/base/SegmentedFilter";
export { default as CopyButton } from "./components/base/CopyButton";
export { default as KpiCard, type KpiCardProps, type KpiTone } from "./components/base/KpiCard";
export { default as RadioCardGroup } from "./components/base/RadioCardGroup";
export { default as FormErrorBanner } from "./components/base/FormErrorBanner";
export { default as TagPill } from "./components/base/TagPill";
export { default as DateTile, type DateTileProps } from "./components/base/DateTile";
export { default as Button, type ButtonProps, type ButtonIntent, type ButtonVariant } from "./components/base/Button";
export { default as ThemeToggle, type ThemeToggleProps, type ThemeToggleValue } from "./components/base/ThemeToggle";
export { default as Dropdown, type DropdownProps, type DropdownItem, type DropdownItemStatus } from "./components/base/Dropdown";
export { default as SocialLinksBar, type SocialLinksBarProps, type SocialLink, type SocialIcon, type SocialLinksShape } from "./components/base/SocialLinksBar";
export { default as StatusIndicator, type StatusIndicatorProps, type StatusIndicatorTone } from "./components/base/StatusIndicator";
export { default as SectionHeading, type SectionHeadingProps, type SectionHeadingAlign, type SectionHeadingLevel } from "./components/base/SectionHeading";
export { default as EyebrowBadge, type EyebrowBadgeProps, type EyebrowTone, type EyebrowTracking } from "./components/base/EyebrowBadge";

// Self-contained modal dialog (promoted from the former host kit). Injects its
// own CSS; no Tailwind / host-brand classes required.
export { default as Modal, type ModalProps, type ModalSize, type ModalTone } from "./components/base/Modal";

// Server-side / client-side data table with debounced search, column sort,
// pagination + "Show more" load mode, a filters slot, optional date filter, and
// an onRefetch handle. Ported from the host kit; injects its own CSS, no Tailwind.
// The type surface mirrors the kernel's @kserp/host-ui contract exactly, so a
// caller written against host-ui works unchanged here.
export {
  default as DataTable,
  type DataTableProps,
  type DataTableColumn,
  type DataTableRow,
  type FetchParams,
  type FetchResult,
} from "./components/base/DataTable";

// ---------------------------------------------------------------------------
// Composite components
// ---------------------------------------------------------------------------

// PaymentAccountPicker composes AccountAvatar inside a searchable dropdown.
export { default as PaymentAccountPicker } from "./components/composite/PaymentAccountPicker";
export type { PaymentAccountOption } from "./components/composite/PaymentAccountPicker";

// LiveTimer wraps ProgressBar with timer state and elapsed-time display.
export { default as LiveTimer, type LiveTimerProps } from "./components/composite/LiveTimer";

// Plugin reusability backlog: composites migrated from per-plugin copies.
export { default as SecretReveal, type SecretRevealProps } from "./components/composite/SecretReveal";
export { default as FormActions, type FormActionsProps } from "./components/composite/FormActions";

// Higher-level widgets: the search-and-create pickers and the mention-aware
// editor that the team treats as composites.
export { default as MentionTextarea } from "./components/composite/MentionTextarea";
export type { MentionTextareaProps } from "./components/composite/MentionTextarea";

export { default as MarkdownNotes } from "./components/composite/MarkdownNotes";
export type { MarkdownNotesProps } from "./components/composite/MarkdownNotes";

// The generic searchable-combobox engine — the ONE picker the library ships.
// Build a payee / client / anything picker by supplying search + onCreate +
// idOf/labelOf/secondaryOf/icon/noun. (The former ClientPicker / PayeePicker
// presets were removed; consumers wire the endpoint themselves.)
export { default as ComboBox } from "./components/composite/ComboBox";
export type {
  ComboBoxProps,
  ComboBoxSingleProps,
  ComboBoxMultiProps,
} from "./components/composite/ComboBox";

// Shared domain option shapes for the common pickers, decoupled from any
// component (still imported across transactions / counter / payees).
export type { ClientOption, PayeeOption, PayeeKind } from "./components/composite/picker-types";

export { default as VoucherPicker, calculateDiscount } from "./components/composite/VoucherPicker";
export type { VoucherOption } from "./components/composite/VoucherPicker";

export { default as NotFound, type NotFoundProps } from "./components/composite/NotFound";

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

// Plugin reusability backlog: formatting helpers migrated from per-plugin copies.
export { formatPHP } from "./utils/formatPHP";
export { formatShortDate } from "./utils/formatShortDate";
export { formatFullDate } from "./utils/formatFullDate";

// Self-contained helpers promoted from the former host kit so the library has no
// "@kserp/host-ui" dependency.
export { highlightMatch, HighlightedText, matchesQuery, matchesAny } from "./utils/highlight";
export { confirm, type ConfirmOptions } from "./utils/confirm";
export { useFocusTrap, autoFocusOnMount, lockPullToRefresh, unlockPullToRefresh } from "./utils/dom";

// Optional host integrations. Components degrade gracefully when these are not
// configured; a host app opts in once at startup.
export {
  configurePermissions,
  configureActiveWorkspace,
  canAccess,
  getActiveWorkspaceId,
} from "./utils/integration";
