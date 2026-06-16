// Single source of truth for the documented surface: every component/util, the
// functional group it belongs to, the version it was added, and (if it has been
// removed from the library) the version it was removed.
//
// Everything that consumes the catalog reads from here:
//   - Sidebar      builds its grouped nav, filtered to the selected version.
//   - PageFooter   walks FLAT order for prev/next.
//   - App          looks up the active route to decide whether to show the
//                  "Obsolete since vX.Y.Z" banner for the selected version.
//   - VersionDropdown drives the selected version.
//
// Adding a component: add one entry here (and its route + page). Removing one:
// DON'T delete the entry — set `removedIn` so the page is retained with an
// obsolete banner and the code example stays available for older versions.

import { compareVersions } from "./versions";

export interface DocEntry {
  label: string;
  path: string;
  /** Version this first shipped in the library. */
  addedIn: string;
  /** Set when the component was removed; its page is kept (obsolete banner). */
  removedIn?: string;
  /** Where to point readers after removal (a replacement component label). */
  replacedBy?: string;
}

export interface DocGroup {
  title: string;
  items: DocEntry[];
}

// "Getting Started" is always visible regardless of the selected version.
export const GETTING_STARTED: DocGroup = {
  title: "Getting Started",
  items: [
    { label: "Introduction", path: "/", addedIn: "0.3.0" },
    { label: "Getting Started", path: "/getting-started", addedIn: "0.3.0" },
  ],
};

// Component + util groups, in display order. Within a group, entries are listed
// roughly by prominence/alpha.
export const GROUPS: DocGroup[] = [
  {
    title: "Buttons & Actions",
    items: [
      { label: "Button", path: "/components/button", addedIn: "0.7.0" },
      { label: "Copy Button", path: "/components/copy-button", addedIn: "0.4.0" },
      { label: "Theme Toggle", path: "/components/theme-toggle", addedIn: "0.7.0" },
      { label: "Form Actions", path: "/components/form-actions", addedIn: "0.4.0" },
    ],
  },
  {
    title: "Forms & Inputs",
    items: [
      { label: "Form Field", path: "/components/form-field", addedIn: "0.4.0" },
      { label: "Radio Card Group", path: "/components/radio-card-group", addedIn: "0.4.0" },
      { label: "Segmented Filter", path: "/components/segmented-filter", addedIn: "0.4.0" },
      { label: "Mention Textarea", path: "/components/mention-textarea", addedIn: "0.3.0" },
    ],
  },
  {
    title: "Pickers",
    items: [
      { label: "Combo Box", path: "/components/combo-box", addedIn: "0.10.0" },
      { label: "Payment Account Picker", path: "/components/payment-account-picker", addedIn: "0.3.0" },
      { label: "Voucher Picker", path: "/components/voucher-picker", addedIn: "0.3.0" },
      { label: "Entity Picker", path: "/components/entity-picker", addedIn: "0.8.0", removedIn: "0.10.0", replacedBy: "Combo Box" },
      { label: "Client Picker", path: "/components/client-picker", addedIn: "0.3.0", removedIn: "0.9.0", replacedBy: "Combo Box" },
      { label: "Payee Picker", path: "/components/payee-picker", addedIn: "0.6.0", removedIn: "0.9.0", replacedBy: "Combo Box" },
    ],
  },
  {
    title: "Data Display",
    items: [
      { label: "Account Avatar", path: "/components/account-avatar", addedIn: "0.3.0" },
      { label: "Detail Row", path: "/components/detail-row", addedIn: "0.4.0" },
      { label: "KPI Card", path: "/components/kpi-card", addedIn: "0.4.0" },
      { label: "Date Tile", path: "/components/date-tile", addedIn: "0.5.0" },
      { label: "Chart Legend", path: "/components/chart-legend", addedIn: "0.4.0" },
      { label: "Progress Bar", path: "/components/progress-bar", addedIn: "0.4.0" },
      { label: "Tag Pill", path: "/components/tag-pill", addedIn: "0.4.0" },
    ],
  },
  {
    title: "Feedback & Status",
    items: [
      { label: "Status Pill", path: "/components/status-pill", addedIn: "0.4.0" },
      { label: "Status Indicator", path: "/components/status-indicator", addedIn: "0.7.0" },
      { label: "Form Error Banner", path: "/components/form-error-banner", addedIn: "0.4.0" },
      { label: "Eyebrow Badge", path: "/components/eyebrow-badge", addedIn: "0.7.0" },
      { label: "Live Timer", path: "/components/live-timer", addedIn: "0.4.0" },
      { label: "Not Found", path: "/components/not-found", addedIn: "0.7.0" },
    ],
  },
  {
    title: "Overlays",
    items: [
      { label: "Modal", path: "/components/modal", addedIn: "0.11.0" },
      { label: "Tooltip", path: "/components/tooltip", addedIn: "0.4.0" },
      { label: "Image Cropper", path: "/components/image-cropper", addedIn: "0.4.0" },
      { label: "Camera Capture", path: "/components/camera-capture", addedIn: "0.3.0" },
      { label: "Secret Reveal", path: "/components/secret-reveal", addedIn: "0.4.0" },
    ],
  },
  {
    title: "Navigation & Headers",
    items: [
      { label: "Section Heading", path: "/components/section-heading", addedIn: "0.7.0" },
      { label: "Dropdown", path: "/components/dropdown", addedIn: "0.7.0" },
      { label: "Social Links Bar", path: "/components/social-links-bar", addedIn: "0.7.0" },
    ],
  },
  {
    title: "Media & Content",
    items: [
      { label: "Markdown Notes", path: "/components/markdown-notes", addedIn: "0.3.0" },
      { label: "Add Attachment Tile", path: "/components/add-attachment-tile", addedIn: "0.3.0" },
      { label: "Existing Attachment Tile", path: "/components/existing-attachment-tile", addedIn: "0.3.0" },
    ],
  },
  {
    title: "Utilities",
    items: [
      { label: "account-icons", path: "/components/account-icons", addedIn: "0.3.0" },
      { label: "attachmentUrl", path: "/components/attachment-url", addedIn: "0.3.0" },
      { label: "buildLogoSrc", path: "/components/build-logo-src", addedIn: "0.3.0" },
      { label: "formatFullDate", path: "/utils/format-full-date", addedIn: "0.4.0" },
      { label: "formatPHP", path: "/utils/format-php", addedIn: "0.4.0" },
      { label: "formatShortDate", path: "/utils/format-short-date", addedIn: "0.4.0" },
      { label: "useAccountsIndex", path: "/components/use-accounts-index", addedIn: "0.3.0" },
    ],
  },
];

export const ALL_GROUPS: DocGroup[] = [GETTING_STARTED, ...GROUPS];

/** Every entry, flattened in display order. */
export const ALL_ENTRIES: DocEntry[] = ALL_GROUPS.flatMap((g) => g.items);

/** Find the registry entry that owns a route path. */
export function entryForPath(path: string): DocEntry | undefined {
  return ALL_ENTRIES.find((e) => e.path === path);
}

/** An entry exists in the docs for the selected version once it has been added. */
export function existsInVersion(entry: DocEntry, version: string): boolean {
  return compareVersions(entry.addedIn, version) <= 0;
}

/**
 * The entry is obsolete *as of* the selected version when it has a removedIn
 * and the selected version is at or past it. (Selecting an older version where
 * the component was still live shows it normally.)
 */
export function isObsoleteInVersion(entry: DocEntry, version: string): boolean {
  return entry.removedIn !== undefined && compareVersions(entry.removedIn, version) <= 0;
}

/** Groups filtered to the selected version (drops not-yet-added entries). */
export function groupsForVersion(version: string): DocGroup[] {
  return ALL_GROUPS.map((g) => ({
    title: g.title,
    items: g.items.filter((e) => existsInVersion(e, version)),
  })).filter((g) => g.items.length > 0);
}
