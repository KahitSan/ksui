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

// Returns the lucide icon to render for an account, preferring the account's
// own icon slug and falling back to the type-based default.
export function getAccountIcon(account: { icon?: string | null; type: string }): IconComponent {
  if (account.icon && (ACCOUNT_ICON_SLUGS as readonly string[]).includes(account.icon)) {
    return ICON_BY_SLUG[account.icon as AccountIconSlug];
  }
  return DEFAULT_BY_TYPE[account.type] ?? Banknote;
}
