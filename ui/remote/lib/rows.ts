// Row shape + synthetic-row factory for the transactions DataTable.
// Extracted verbatim from index.tsx. `TransactionRow` is the table's row
// generic (a Transaction plus optional grouping markers); `makeAggregatedRow`
// builds the synthetic per-day "grouped" row from a grouped-by-date entry.
// The factory takes orgId as a parameter (the caller threads activeOrg()) so it
// stays pure — no closure over the host context.

import { type Transaction } from "./types";

export type TransactionRow = Transaction & {
  _grouped?: boolean;
  _groupKey?: string;
  _groupDate?: string;
  _groupCount?: number;
  _groupTotal?: number;
  _groupIds?: number[];
  _isSubrow?: boolean;
};

export function makeAggregatedRow(
  d: {
    date: string;
    count: number;
    total: string | number;
    currency: string;
  },
  orgId: number,
): TransactionRow {
  const totalNum = typeof d.total === "string" ? parseFloat(d.total) : d.total;
  return {
    id: -1,
    workspace_id: orgId,
    category: "sale",
    subcategory: null,
    source_account_id: null,
    destination_account_id: null,
    source_account_name: null,
    destination_account_name: null,
    amount: String(Number.isFinite(totalNum) ? totalNum : 0),
    currency: d.currency || "PHP",
    description: "",
    notes: null,
    transaction_date: d.date,
    is_private: false,
    status: "active",
    is_backdated: false,
    backdate_reason: null,
    created_by: "",
    created_by_name: null,
    created_by_image: null,
    updated_by: null,
    updated_by_name: null,
    updated_by_image: null,
    attachment_count: "0",
    payee: null,
    payee_id: null,
    reference_number: null,
    tax_type: "none",
    tax_rate: "0",
    tax_amount: "0",
    subtotal: null,
    has_ewt: false,
    ewt_rate: null,
    ewt_amount: null,
    payable_kind: null,
    due_date: null,
    cheque_number: null,
    pdc_status: null,
    created_at: "",
    updated_at: "",
    _grouped: true,
    _groupKey: d.date,
    _groupDate: d.date,
    _groupCount: d.count,
    _groupTotal: Number.isFinite(totalNum) ? totalNum : 0,
  };
}
