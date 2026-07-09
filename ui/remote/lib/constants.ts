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
      class: "border-ks-danger/40 text-ks-danger bg-ks-danger/20",
    },
    sale: {
      label: "Income",
      class: "border-ks-success/40 text-ks-success bg-ks-success/20",
    },
    business: {
      label: "Transfer",
      class: "border-ks-info/40 text-ks-info bg-ks-info/20",
    },
    payable: {
      label: "Payable",
      class: "border-ks-accent/40 text-ks-accent bg-ks-accent/20",
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
    bg: "bg-ks-success/10",
    text: "text-ks-success",
    border: "border-ks-success/30",
  },
  red: {
    bg: "bg-ks-danger/10",
    text: "text-ks-danger",
    border: "border-ks-danger/30",
  },
  blue: {
    bg: "bg-ks-info/10",
    text: "text-ks-info",
    border: "border-ks-info/30",
  },
  amber: {
    bg: "bg-ks-accent/10",
    text: "text-ks-accent",
    border: "border-ks-accent/30",
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
  { id: "issued", label: "PDC issued", dot: "bg-ks-accent" },
  { id: "presented", label: "PDC presented", dot: "bg-ks-info" },
  { id: "cleared", label: "PDC cleared", dot: "bg-ks-success" },
  { id: "bounced", label: "PDC bounced", dot: "bg-ks-danger" },
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
