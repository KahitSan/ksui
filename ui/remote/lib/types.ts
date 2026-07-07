// Shared domain types for the transactions remote UI. Extracted from index.tsx
// so every later-extracted component/hook module imports the same definitions
// instead of re-declaring them. IconComponent is a type-only alias (no JSX),
// safe here. PendingFile is imported from @kahitsan/ksui.

import type { JSX } from "solid-js";

export interface Transaction {
  id: number;
  workspace_id: number;
  category: string;
  subcategory: string | null;
  source_account_id: number | null;
  destination_account_id: number | null;
  source_account_name: string | null;
  destination_account_name: string | null;
  amount: string;
  currency: string;
  description: string;
  notes: string | null;
  transaction_date: string;
  is_private: boolean;
  status: string;
  is_backdated: boolean;
  backdate_reason: string | null;
  created_by: string;
  created_by_name: string | null;
  created_by_image: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_by_image: string | null;
  attachment_count: string;
  payee: string | null;
  payee_id: number | null;
  reference_number: string | null;
  tax_type: string;
  tax_rate: string;
  tax_amount: string;
  subtotal: string | null;
  has_ewt: boolean;
  ewt_rate: string | null;
  ewt_amount: string | null;
  payable_kind: string | null;
  due_date: string | null;
  cheque_number: string | null;
  pdc_status: string | null;
  created_at: string;
  updated_at: string;
  attachments?: Attachment[];
  shared_with?: { user_id: string; name: string; image?: string | null }[];
  shared_with_roles?: { role_code: string; label: string }[];
  client_id?: number | null;
  voucher_id?: number | null;
  discount_amount?: string | null;
  client_name?: string | null;
  voucher?: { id: number; code: string; type: string; value: string } | null;
  line_items?: TransactionLineItem[];
  amount_collected?: string | null;
  balance?: string | null;
  payment_status?: "paid" | "partial" | "unpaid" | "voided" | "forfeited" | null;
  payments?: TransactionPayment[];
}

interface TransactionPayment {
  id: number;
  financial_account_id: number;
  financial_account_name: string | null;
  amount: string;
  notes: string | null;
  created_at: string;
}

interface TransactionLineItem {
  id: number;
  package_id: number | null;
  package_variant_id: number | null;
  description: string;
  quantity: number;
  unit_price: string;
  duration_value: string;
  duration_unit: "hour" | "day" | "month";
  started_at: string | null;
  ends_at: string | null;
  status: string;
  client_id: number | null;
  package_name: string | null;
  variant_name: string | null;
  variant_kind: string | null;
  client_name: string | null;
}

export interface Attachment {
  id: number;
  file_name: string;
  file_size: number;
  mime_type: string;
  s3_link: string;
  created_at: string;
}

export interface FinancialAccount {
  id: number;
  name: string;
  type: string;
  icon?: string | null;
  color?: string | null;
  s3_link?: string | null;
  is_active: boolean;
  balance?: number | string;
}

export interface OrgMember {
  user_id: string;
  name: string;
  role: string;
}

export interface ShareableRole {
  code: string;
  label: string;
}

export type IconComponent = (props: {
  size?: number;
  class?: string;
}) => JSX.Element;
