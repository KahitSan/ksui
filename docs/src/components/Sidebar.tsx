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

// Two tier nav: a Getting Started group, then an alphabetical Components group.
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
    title: "General components",
    items: [
      { label: "Camera Capture", path: "/components/camera-capture" },
      { label: "Add Attachment Tile", path: "/components/add-attachment-tile" },
      { label: "Existing Attachment Tile", path: "/components/existing-attachment-tile" },
      { label: "buildLogoSrc", path: "/components/build-logo-src" },
      { label: "attachmentUrl", path: "/components/attachment-url" },
    ],
  },
  {
    title: "ERP components",
    items: [
      { label: "Mention Textarea", path: "/components/mention-textarea" },
      { label: "Markdown Notes", path: "/components/markdown-notes" },
      { label: "Client Picker", path: "/components/client-picker" },
      { label: "Voucher Picker", path: "/components/voucher-picker" },
      { label: "Payment Account Picker", path: "/components/payment-account-picker" },
      { label: "Account Avatar", path: "/components/account-avatar" },
      { label: "Account Icon Helpers", path: "/components/account-icons" },
      { label: "Accounts Index", path: "/components/use-accounts-index" },
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
