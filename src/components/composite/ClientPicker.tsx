// ClientPicker — the client preset of EntityPicker. A searchable combobox for a
// "billed-to" / client field, backed by the sibling clients plugin's
// /api/clients. All the popup mechanics live in EntityPicker; this file only
// wires the clients endpoint, option shape (name_raw + email/phone), icon, and
// the post-create callback.
//
// Public API is unchanged from the standalone version, so existing callers keep
// working. Degrades gracefully when the clients plugin isn't deployed.

import { type JSX } from "solid-js";
import UserRound from "lucide-solid/icons/user-round";
import EntityPicker from "./EntityPicker";

export interface ClientOption {
  id: number;
  name_raw: string;
  email?: string | null;
  phone?: string | null;
}

interface ClientPickerProps {
  selected: ClientOption | null;
  onChange: (next: ClientOption | null) => void;
  onCreate?: (created: ClientOption) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
}

async function searchClients(query: string): Promise<ClientOption[]> {
  const params = new URLSearchParams({ status: "active", limit: "10" });
  if (query) params.set("search", query);
  const r = await fetch(`/api/clients?${params.toString()}`, { credentials: "include" });
  if (!r.ok) {
    throw new Error(
      r.status === 403
        ? "Permission denied"
        : r.status === 404
          ? "Clients module isn't available — type a name instead"
          : "Failed to load",
    );
  }
  const json = await r.json();
  return (json.data || []) as ClientOption[];
}

async function createClient(name: string): Promise<ClientOption> {
  const res = await fetch("/api/clients", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name_raw: name }),
  });
  if (!res.ok && res.status !== 200) {
    const body = await res.json().catch(() => ({ error: "Failed to create client" }));
    throw new Error(body.error || "Failed to create client");
  }
  return (await res.json()) as ClientOption;
}

function clientSecondary(c: ClientOption): string | null {
  return [c.email, c.phone].filter(Boolean).join(" · ") || null;
}

export default function ClientPicker(props: ClientPickerProps): JSX.Element {
  return (
    <EntityPicker<ClientOption>
      selected={props.selected}
      onChange={props.onChange}
      search={searchClients}
      onCreate={async (name) => {
        const created = await createClient(name);
        props.onCreate?.(created);
        return created;
      }}
      idOf={(c) => c.id}
      labelOf={(c) => c.name_raw}
      secondaryOf={clientSecondary}
      icon={UserRound}
      noun="client"
      placeholder="Walk-in"
      disabled={props.disabled}
      defaultOpen={props.defaultOpen}
      testIdPrefix="client-picker"
    />
  );
}
