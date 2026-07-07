// Pure data layer for the financial-accounts remote UI: the account shape, the
// type-badge lookup, and the two formatting helpers. No Solid, no DOM, no fetch
// — everything in the UI tree imports from here.

export interface FinancialAccount {
  id: number;
  workspace_id: number;
  name: string;
  type: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  s3_link: string | null;
  // balance arrives as a string from the DB (NUMERIC) when the transactions
  // plugin is loaded; absent (undefined) when it is feature-flagged off.
  balance?: string | number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const TYPE_LABELS: Record<string, { label: string; class: string }> = {
  bank: {
    label: "Bank",
    class: "border-blue-400/40 text-blue-400 bg-blue-500/20",
  },
  e_wallet: {
    label: "E-Wallet",
    class: "border-violet-400/40 text-violet-400 bg-violet-500/20",
  },
  cash: {
    label: "Cash",
    class: "border-emerald-400/40 text-emerald-400 bg-emerald-500/20",
  },
  external: {
    label: "External",
    class: "border-zinc-600 text-zinc-400 bg-zinc-800/50",
  },
  capital: {
    label: "Capital",
    class: "border-amber-400/40 text-amber-400 bg-amber-500/20",
  },
};

// Capital accounts represent funding put in by an owner / investor / funder.
// Money flowing OUT of the account = contribution to the business; money
// flowing back IN = repayment to the contributor. The raw balance is therefore
// negative while there is unreturned capital, which would read as "debt" in
// the default red-negative styling and lose the meaning of the row.
export function capitalRowFigures(balance: string | number): {
  outstanding: number;
  overpaid: boolean;
  overpayment: number;
} {
  const bal = typeof balance === "string" ? parseFloat(balance) : balance;
  if (bal > 0) return { outstanding: 0, overpaid: true, overpayment: bal };
  return { outstanding: -bal, overpaid: false, overpayment: 0 };
}

export function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(num);
}
