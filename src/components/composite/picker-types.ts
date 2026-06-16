// Domain option shapes shared across the KahitSan plugins.
//
// These previously lived inside the ClientPicker / PayeePicker preset
// components. Those presets were removed in favour of using the generic
// ComboBox directly (consumers wire their own search/onCreate), but the
// option TYPES are still imported widely (transactions, counter, payees), so
// they keep a stable home here decoupled from any component.

export type PayeeKind = "vendor" | "customer" | "both";

export interface PayeeOption {
  id: number;
  name: string;
  kind: PayeeKind;
  default_subcategory?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export interface ClientOption {
  id: number;
  name_raw: string;
  email?: string | null;
  phone?: string | null;
}
