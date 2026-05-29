// Source: KahitSan/kserp src/components/AccountAvatar.tsx (vendored into the plugin remote).
// Renders an account's logo (1:1 image streamed via the org-scoped logo route)
// or its type/icon-based lucide glyph fallback. Bare glyph, no chip background.

import { Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { getAccountIcon } from "../lib/account-icons";
import { buildLogoSrc } from "../lib/account-logo-url";

export interface AvatarAccount {
  id: number;
  logo_path?: string | null;
  icon?: string | null;
  color?: string | null;
  type: string;
}

interface AccountAvatarProps {
  account: AvatarAccount;
  size?: number;
  class?: string;
  iconClass?: string;
  alt?: string;
}

export default function AccountAvatar(props: AccountAvatarProps) {
  const size = () => props.size ?? 28;
  const iconSize = () => Math.max(12, Math.round(size() * 0.6));
  const iconStyle = () => (props.account.color ? { color: props.account.color } : undefined);
  return (
    <span
      data-testid={`account-avatar-${props.account.id}`}
      class={`inline-flex items-center justify-center shrink-0 ${props.class ?? ""}`}
      style={{ width: `${size()}px`, height: `${size()}px` }}
    >
      <Show
        when={props.account.logo_path}
        fallback={
          <Dynamic
            component={getAccountIcon(props.account)}
            size={iconSize()}
            class={props.iconClass ?? "text-zinc-300"}
            style={iconStyle()}
          />
        }
      >
        <img
          src={buildLogoSrc(props.account.logo_path)}
          alt={props.alt ?? ""}
          class="w-full h-full rounded-md object-cover"
        />
      </Show>
    </span>
  );
}
