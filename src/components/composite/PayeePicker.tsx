// PayeePicker — the payee preset of EntityPicker. A searchable combobox for the
// "Paid to" / "Received from" / "Payable to" field, backed by the sibling payees
// plugin's /api/payees. All the popup mechanics live in EntityPicker; this file
// only wires the payee endpoint, option shape, icon, and create-as-kind.
//
// Public API is unchanged from the standalone version, so existing callers keep
// working. Degrades gracefully — a missing payees plugin surfaces a notice and
// the free-text fallback (selectedName) keeps the trigger usable.

import { type JSX } from "solid-js";
import Store from "lucide-solid/icons/store";
import EntityPicker from "./EntityPicker";

export type PayeeKind = "vendor" | "customer" | "both";

export interface PayeeOption {
  id: number;
  name: string;
  kind: PayeeKind;
  default_subcategory?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

interface PayeePickerProps {
  selected: PayeeOption | null;
  selectedName?: string | null;
  kind?: PayeeKind;
  createAsKind?: PayeeKind;
  placeholder?: string;
  onChange: (next: PayeeOption | null) => void;
  disabled?: boolean;
  testIdPrefix?: string;
}

async function searchPayees(query: string, kind?: PayeeKind): Promise<PayeeOption[]> {
  const params = new URLSearchParams({ status: "active", limit: "20" });
  if (query) params.set("search", query);
  if (kind) params.set("kind", kind);
  const r = await fetch(`/api/payees?${params.toString()}`, { credentials: "include" });
  if (!r.ok) {
    throw new Error(
      r.status === 403
        ? "Permission denied"
        : r.status === 404
          ? "Payees module isn't available — type a name instead"
          : "Failed to load",
    );
  }
  const json = await r.json();
  return (json.data || []) as PayeeOption[];
}

async function createPayee(name: string, kind: PayeeKind): Promise<PayeeOption> {
  const res = await fetch("/api/payees", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, kind }),
  });
  if (!res.ok && res.status !== 200) {
    const body = await res.json().catch(() => ({ error: "Failed to create payee" }));
    throw new Error(body.error || "Failed to create payee");
  }
  return (await res.json()) as PayeeOption;
}

function payeeSecondary(p: PayeeOption): string | null {
  if (!p.default_subcategory && p.kind === "vendor") return null;
  return [p.kind === "vendor" ? null : p.kind, p.default_subcategory].filter(Boolean).join(" · ") || null;
}

export default function PayeePicker(props: PayeePickerProps): JSX.Element {
  return (
    <EntityPicker<PayeeOption>
      selected={props.selected}
      selectedName={props.selectedName}
      onChange={props.onChange}
      search={(q) => searchPayees(q, props.kind)}
      onCreate={(name) => createPayee(name, props.createAsKind ?? props.kind ?? "vendor")}
      idOf={(p) => p.id}
      labelOf={(p) => p.name}
      secondaryOf={payeeSecondary}
      icon={Store}
      noun="payee"
      placeholder={props.placeholder}
      disabled={props.disabled}
      testIdPrefix={props.testIdPrefix ?? "payee-picker"}
    />
  );
}
