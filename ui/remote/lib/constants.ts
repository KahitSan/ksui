// Module-level constant tables for the transactions remote UI. Extracted from
// index.tsx verbatim. CATEGORY_TONE references lucide-solid icon components but
// uses no JSX syntax, so a .ts file works (icons imported here).

import ArrowDownLeft from "lucide-solid/icons/arrow-down-left";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import ArrowRightLeft from "lucide-solid/icons/arrow-right-left";
import CalendarDays from "lucide-solid/icons/calendar-days";
import { type IconComponent } from "./types";

export const CATEGORY_STYLES: Record<string, { label: string; class: string }> =
  {
    expense: {
      label: "Expense",
      class: "border-red-400/40 text-red-400 bg-red-500/20",
    },
    sale: {
      label: "Income",
      class: "border-emerald-400/40 text-emerald-400 bg-emerald-500/20",
    },
    business: {
      label: "Transfer",
      class: "border-blue-400/40 text-blue-400 bg-blue-500/20",
    },
    payable: {
      label: "Payable",
      class: "border-amber-400/40 text-amber-400 bg-amber-500/20",
    },
  };

export const CATEGORY_TONE: Record<
  string,
  {
    tone: "emerald" | "red" | "blue" | "amber";
    sign: "+" | "-" | "";
    icon: IconComponent;
  }
> = {
  sale: { tone: "emerald", sign: "+", icon: ArrowDownLeft },
  expense: { tone: "red", sign: "-", icon: ArrowUpRight },
  payable: { tone: "amber", sign: "-", icon: CalendarDays },
  business: { tone: "blue", sign: "", icon: ArrowRightLeft },
};

export const TONE_CLASSES: Record<
  "emerald" | "red" | "blue" | "amber",
  { bg: string; text: string; border: string }
> = {
  emerald: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
  },
  red: {
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/30",
  },
  blue: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/30",
  },
  amber: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/30",
  },
};

export const PAYABLE_KIND_OPTIONS: { id: string; label: string }[] = [
  { id: "subscription", label: "Subscription" },
  { id: "utility", label: "Utility" },
  { id: "rent", label: "Rent / Lease" },
  { id: "loan", label: "Loan" },
  { id: "tax", label: "Tax" },
  { id: "other", label: "Other" },
];

export const PDC_OPTIONS: { id: string; label: string; dot: string }[] = [
  { id: "issued", label: "PDC issued", dot: "bg-amber-400" },
  { id: "presented", label: "PDC presented", dot: "bg-blue-400" },
  { id: "cleared", label: "PDC cleared", dot: "bg-emerald-400" },
  { id: "bounced", label: "PDC bounced", dot: "bg-red-400" },
];

export const TAX_TYPE_LABELS: Record<string, string> = {
  vat_inclusive: "VAT Inclusive",
  vat_exclusive: "VAT Exclusive",
  vat_exempt: "VAT Exempt",
  non_vat: "Non-VAT",
};

export const CATEGORY_FORM: Record<
  string,
  {
    label: string;
    hint: string;
    descPlaceholder: string;
    accountLabel: string;
    accountHint: string;
    showSecondAccount: boolean;
    secondAccountLabel?: string;
    payeeLabel?: string;
    payeePlaceholder?: string;
    showPayee: boolean;
  }
> = {
  expense: {
    label: "Expense",
    hint: "Money going out -- paying for supplies, bills, services",
    descPlaceholder: 'What did you pay for? e.g. "Office supplies"',
    accountLabel: "Paid from",
    accountHint: "Which account was used to pay?",
    showSecondAccount: false,
    payeeLabel: "Paid to",
    payeePlaceholder: 'Store or vendor name, e.g. "Jollibee Magsaysay"',
    showPayee: true,
  },
  sale: {
    label: "Income",
    hint: "Money coming in -- payment received from a customer, client, or other source",
    descPlaceholder: 'What came in? e.g. "Day pass - Walk-in"',
    accountLabel: "Received in",
    accountHint: "Where did the payment go?",
    showSecondAccount: false,
    payeeLabel: "Received from",
    payeePlaceholder: "Customer name (optional)",
    showPayee: true,
  },
  business: {
    label: "Transfer",
    hint: "Moving money between your own accounts",
    descPlaceholder: 'Why? e.g. "Replenish petty cash from bank"',
    accountLabel: "From account",
    accountHint: "",
    showSecondAccount: true,
    secondAccountLabel: "To account",
    showPayee: false,
  },
  payable: {
    label: "Payable",
    hint: "Recurring or scheduled payment -- subscription, utility, rent, loan, tax",
    descPlaceholder: 'What is it? e.g. "Office rent -- May"',
    accountLabel: "Funding account",
    accountHint: "Which account will be debited when this is paid?",
    showSecondAccount: false,
    payeeLabel: "Payable to",
    payeePlaceholder: 'Vendor or biller name, e.g. "MERALCO"',
    showPayee: true,
  },
};
