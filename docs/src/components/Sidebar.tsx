import { For, type JSX } from "solid-js";
import { A, useLocation } from "@solidjs/router";

interface NavItem {
  label: string;
  path: string;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

// Nav groups: Getting Started, the host provided primitives (Host kit), then the
// ksui package components split by category (Base vs Composite), then the
// library helpers. Base is a standalone primitive; Composite wraps a base or
// composes two or more components.
export const NAV: NavGroup[] = [
  {
    title: "Getting Started",
    items: [
      { label: "Introduction", path: "/" },
      { label: "Getting Started", path: "/getting-started" },
    ],
  },
  {
    title: "Host kit",
    items: [
      { label: "Button", path: "/components/button" },
      { label: "Modal", path: "/components/modal" },
    ],
  },
  {
    title: "Base components",
    items: [
      { label: "Account Avatar", path: "/components/account-avatar" },
      { label: "Add Attachment Tile", path: "/components/add-attachment-tile" },
      { label: "Button (HUD)", path: "/components/hud-button" },
      { label: "Camera Capture", path: "/components/camera-capture" },
      { label: "Chart Legend", path: "/components/chart-legend" },
      { label: "Copy Button", path: "/components/copy-button" },
      { label: "Date Tile", path: "/components/date-tile" },
      { label: "Detail Row", path: "/components/detail-row" },
      { label: "Dropdown", path: "/components/dropdown" },
      { label: "Existing Attachment Tile", path: "/components/existing-attachment-tile" },
      { label: "Eyebrow Badge", path: "/components/eyebrow-badge" },
      { label: "Form Error Banner", path: "/components/form-error-banner" },
      { label: "Form Field", path: "/components/form-field" },
      { label: "Image Cropper", path: "/components/image-cropper" },
      { label: "KPI Card", path: "/components/kpi-card" },
      { label: "Progress Bar", path: "/components/progress-bar" },
      { label: "Radio Card Group", path: "/components/radio-card-group" },
      { label: "Section Heading", path: "/components/section-heading" },
      { label: "Segmented Filter", path: "/components/segmented-filter" },
      { label: "SocialLinksBar", path: "/components/social-links-bar" },
      { label: "StatusIndicator", path: "/components/status-indicator" },
      { label: "Status Pill", path: "/components/status-pill" },
      { label: "Tag Pill", path: "/components/tag-pill" },
      { label: "ThemeToggle", path: "/components/theme-toggle" },
      { label: "Tooltip", path: "/components/tooltip" },
    ],
  },
  {
    title: "Composite components",
    items: [
      { label: "Client Picker", path: "/components/client-picker" },
      { label: "Entity Picker", path: "/components/entity-picker" },
      { label: "Form Actions", path: "/components/form-actions" },
      { label: "Live Timer", path: "/components/live-timer" },
      { label: "Markdown Notes", path: "/components/markdown-notes" },
      { label: "Mention Textarea", path: "/components/mention-textarea" },
      { label: "Not Found", path: "/components/not-found" },
      { label: "Payee Picker", path: "/components/payee-picker" },
      { label: "Payment Account Picker", path: "/components/payment-account-picker" },
      { label: "Secret Reveal", path: "/components/secret-reveal" },
      { label: "Voucher Picker", path: "/components/voucher-picker" },
    ],
  },
  {
    title: "Utils",
    items: [
      { label: "account-icons", path: "/components/account-icons" },
      { label: "attachmentUrl", path: "/components/attachment-url" },
      { label: "buildLogoSrc", path: "/components/build-logo-src" },
      { label: "formatFullDate", path: "/utils/format-full-date" },
      { label: "formatPHP", path: "/utils/format-php" },
      { label: "formatShortDate", path: "/utils/format-short-date" },
      { label: "useAccountsIndex", path: "/components/use-accounts-index" },
    ],
  },
];

// Flattened ordering for Previous / Next footer links.
export const FLAT_NAV: NavItem[] = NAV.flatMap((g) => g.items);

export function Sidebar(): JSX.Element {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  return (
    <nav class="sidebar" aria-label="Primary">
      <For each={NAV}>
        {(group) => (
          <div class="sidebar-group">
            <div class="sidebar-group-title">{group.title}</div>
            <ul class="sidebar-list">
              <For each={group.items}>
                {(item) => (
                  <li>
                    <A
                      href={item.path}
                      class="sidebar-link"
                      classList={{ active: isActive(item.path) }}
                    >
                      {item.label}
                    </A>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
    </nav>
  );
}
