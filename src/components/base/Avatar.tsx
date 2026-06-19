import AccountAvatar, { type AvatarAccount } from "./AccountAvatar";

export interface AvatarProps {
  name: string;
  image?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  class?: string;
}

const sizeMap: Record<string, number> = {
  xs: 20,
  sm: 24,
  md: 28,
  lg: 40,
};

/**
 * Generic person/user avatar — a thin, domain-free wrapper over {@link AccountAvatar}'s
 * user variant that accepts a name + optional image and a t-shirt size. Use this for
 * people; use AccountAvatar directly for financial accounts.
 */
export default function Avatar(props: AvatarProps) {
  const account: AvatarAccount = {
    id: 0,
    type: "user",
    name: props.name,
    image: props.image,
  };

  return <AccountAvatar account={account} size={sizeMap[props.size ?? "md"]} class={props.class} />;
}
