// Source: KahitSan/kserp src/lib/account-icons.ts (vendored into the plugin remote).
// Maps an account-icon slug → lucide glyph, with a type-based fallback for
// accounts that have no custom icon yet. Used by AccountAvatar.

import Banknote from "lucide-solid/icons/banknote";
import Landmark from "lucide-solid/icons/landmark";
import Building from "lucide-solid/icons/building";
import CreditCard from "lucide-solid/icons/credit-card";
import Smartphone from "lucide-solid/icons/smartphone";
import Wallet from "lucide-solid/icons/wallet";
import Coins from "lucide-solid/icons/coins";
import PiggyBank from "lucide-solid/icons/piggy-bank";
import DollarSign from "lucide-solid/icons/dollar-sign";
import Receipt from "lucide-solid/icons/receipt";
import type { Component, JSX } from "solid-js";

export type IconComponent = Component<JSX.SvgSVGAttributes<SVGSVGElement> & { size?: number }>;

export const ACCOUNT_ICON_SLUGS = [
  "banknote",
  "landmark",
  "building",
  "credit-card",
  "smartphone",
  "wallet",
  "coins",
  "piggy-bank",
  "dollar-sign",
  "receipt",
] as const;

export type AccountIconSlug = (typeof ACCOUNT_ICON_SLUGS)[number];

const ICON_BY_SLUG: Record<AccountIconSlug, IconComponent> = {
  banknote: Banknote,
  landmark: Landmark,
  building: Building,
  "credit-card": CreditCard,
  smartphone: Smartphone,
  wallet: Wallet,
  coins: Coins,
  "piggy-bank": PiggyBank,
  "dollar-sign": DollarSign,
  receipt: Receipt,
};

const DEFAULT_BY_TYPE: Record<string, IconComponent> = {
  bank: Banknote,
  e_wallet: Smartphone,
  cash: Wallet,
  capital: PiggyBank,
};

// Pretty labels for the icon picker (financial-accounts create/edit modal).
export const ACCOUNT_ICON_LABELS: Record<AccountIconSlug, string> = {
  banknote: "Banknote",
  landmark: "Landmark",
  building: "Building",
  "credit-card": "Credit card",
  smartphone: "Smartphone",
  wallet: "Wallet",
  coins: "Coins",
  "piggy-bank": "Piggy bank",
  "dollar-sign": "Dollar sign",
  receipt: "Receipt",
};

// Returns the lucide icon to render for an account, preferring the account's
// own icon slug and falling back to the type-based default.
export function getAccountIcon(account: { icon?: string | null; type: string }): IconComponent {
  if (account.icon && (ACCOUNT_ICON_SLUGS as readonly string[]).includes(account.icon)) {
    return ICON_BY_SLUG[account.icon as AccountIconSlug];
  }
  return DEFAULT_BY_TYPE[account.type] ?? Banknote;
}

const DEFAULT_TONE_BY_TYPE: Record<string, { text: string; bg: string; border: string }> = {
  bank: { text: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-400/40" },
  e_wallet: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-400/40" },
  cash: { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-400/40" },
  capital: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-400/40" },
};

const FALLBACK_TONE = {
  text: "text-zinc-300",
  bg: "bg-zinc-700/30",
  border: "border-zinc-700/60",
};

// Per-type accent tone for an account chip, or the account's own custom color.
export function getAccountTone(account: { color?: string | null; type: string }): {
  class?: string;
  style?: JSX.CSSProperties;
} {
  if (account.color) {
    return {
      style: {
        color: account.color,
        "background-color": `${account.color}1a`,
        "border-color": `${account.color}66`,
      },
    };
  }
  const tone = DEFAULT_TONE_BY_TYPE[account.type] ?? FALLBACK_TONE;
  return { class: `${tone.text} ${tone.bg} ${tone.border}` };
}
