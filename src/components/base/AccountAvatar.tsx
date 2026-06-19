// AccountAvatar renders a small visual chip for an account or a user.
//
// Two distinct semantics share this chip, and the chip picks by intent:
//
//   • ACCOUNT (a financial account, the default). Shows the account's
//     uploaded logo, else its chosen icon glyph (the slug picked in the
//     financial-accounts create/edit modal, or the type default). NEVER an
//     initials circle, and the container is a ROUNDED SQUARE (rounded-md).
//     This matches the /financial-accounts page exactly. A financial
//     account is not a person, so it must not render as an initials avatar.
//
//   • USER (a person badge for calendar entries, mention lists, timesheet
//     attribution). Shows the profile photo, else an initial-on-color
//     CIRCLE, in a circular (rounded-full) container. Callers opt in with
//     `{ id: 0, type: 'user', name: 'Myra Abilay', image }` (the `type:
//     'user'` is the signal) or by passing `variant="user"` explicitly.
//
// The variant is inferred from `account.type === 'user'` and can be forced
// with the `variant` prop. Both paths render their image through the same
// <img> so chip sizing is identical regardless of source.

import { Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { getAccountIcon } from "../../utils/account-icons";
import { buildLogoSrc } from "../../utils/account-logo-url";

// Shared 16-color palette and initials algorithm. Keep in lockstep with
// the original ~/lib/avatar.ts so the host runtime and the plugin fleet
// render the same chip for the same user.  Exported so any future widget
// (or a caller's inline use) can derive a user's color/initials without
// rendering the chip itself.
const AVATAR_PALETTE = [
  "#e11d48", "#db2777", "#c026d3", "#9333ea", "#7c3aed",
  "#4f46e5", "#2563eb", "#0284c7", "#0891b2", "#0d9488",
  "#059669", "#65a30d", "#ca8a04", "#ea580c", "#dc2626",
];
export function getInitials(name: string): string {
  const trimmed = name?.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
export function getAvatarColor(name: string): string {
  if (!name) return AVATAR_PALETTE[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

/** Build a base64 SVG data URL for the initial-on-color circle.  Because it
 *  renders as an `<img>`, the chip scales uniformly with every other source
 *  (photo, s3 logo), so there is no per-plugin/inline text-size drift.  The viewBox is
 *  100×100 and the font-size is calculated to keep 2-character initials
 *  comfortably inside the circle. */
export function buildInitialsSvg(name: string): string {
  const initials = getInitials(name);
  const color = getAvatarColor(name);
  const fontSize = initials.length > 1 ? 38 : 44;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    `<circle cx="50" cy="50" r="50" fill="${color}"/>`,
    `<text x="50" y="50" text-anchor="middle" dominant-baseline="central" ` +
      `fill="white" font-size="${fontSize}" font-weight="bold" ` +
      `font-family="system-ui,-apple-system,sans-serif">${initials}</text>`,
    "</svg>",
  ].join("");
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface AvatarAccount {
  id: number | string;
  s3_link?: string | null;
  icon?: string | null;
  color?: string | null;
  type: string;
  /** Display name. Only used by the USER variant: when no photo is set the
   *  chip falls through to an initial-on-color circle. Ignored by the
   *  account variant, which never renders initials. */
  name?: string;
  /** User profile photo URL (e.g. Google identity provider). USER variant
   *  only. Higher priority than the initials fallback. */
  image?: string | null;
}

interface AccountAvatarProps {
  account: AvatarAccount;
  size?: number;
  class?: string;
  iconClass?: string;
  alt?: string;
  /** Force the rendering intent. Defaults to "user" when
   *  `account.type === 'user'`, otherwise "account". */
  variant?: "account" | "user";
}

export default function AccountAvatar(props: AccountAvatarProps) {
  const size = () => props.size ?? 28;
  const iconSize = () => Math.max(12, Math.round(size() * 0.6));
  const iconStyle = () => (props.account.color ? { color: props.account.color } : undefined);

  const isUser = () =>
    props.variant === "user" ||
    (props.variant == null && props.account.type === "user");

  // USER source: profile photo, else the initial-on-color circle.
  const userImgSrc = () => {
    if (props.account.s3_link) return buildLogoSrc(props.account.s3_link);
    if (props.account.image) return props.account.image;
    if (props.account.name) return buildInitialsSvg(props.account.name);
    return null;
  };

  const iconGlyph = () => (
    <Dynamic
      component={getAccountIcon(props.account)}
      size={iconSize()}
      class={props.iconClass ?? "text-zinc-300"}
      style={iconStyle()}
    />
  );

  return (
    <span
      data-testid={`account-avatar-${props.account.id}`}
      class={`inline-flex items-center justify-center shrink-0 ${props.class ?? ""}`}
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
      }}
      title={props.account.name}
    >
      <Show
        when={isUser()}
        fallback={
          // ACCOUNT: uploaded logo (rounded square), else the chosen icon
          // glyph. No initials, since a financial account is not a person.
          <Show when={props.account.s3_link} fallback={iconGlyph()}>
            <img
              src={buildLogoSrc(props.account.s3_link)}
              alt={props.alt ?? ""}
              class="w-full h-full rounded-md object-cover"
            />
          </Show>
        }
      >
        {/* USER: profile photo or initial-on-color circle. */}
        <Show when={userImgSrc()} fallback={iconGlyph()}>
          <img
            src={userImgSrc()!}
            alt={props.alt ?? (props.account.name ?? "")}
            class="w-full h-full rounded-full object-cover"
            onError={(e) => {
              // A profile photo / s3 logo that expired or was deleted
              // degrades to the initial-on-color SVG instead of the
              // broken-image icon.
              if (props.account.name && !props.account.s3_link) {
                (e.currentTarget as HTMLImageElement).src =
                  buildInitialsSvg(props.account.name);
              }
            }}
          />
        </Show>
      </Show>
    </span>
  );
}
