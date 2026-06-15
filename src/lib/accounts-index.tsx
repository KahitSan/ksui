// Source: KahitSan/kserp src/lib/accounts-index.tsx (promoted into the SDK).
//
// Session-scoped index of financial accounts keyed by id. The list rows, the
// detail payments list, etc. surface accounts by name only (server denormalises
// source/destination names and drops icon/color/logo_path). This index lets any
// render site resolve an id → AvatarAccount synchronously so AccountAvatar can
// show the right glyph/logo.
//
// The monolith mounts a Provider in the app shell and shares one resource via
// context. The plugin remote has no such provider, so this version owns a
// module-level resource created on first use and re-keyed on the active org id
// (read from the host's useActiveWorkspace()). Because plugin-ui ships as source
// compiled into each plugin's IIFE, the module-level singleton stays per-plugin.
// Degrades gracefully: when the financial-accounts plugin isn't deployed the
// fetch 404s/fails and the index stays empty, so resolveAccount() then falls back
// to the type-default glyph.

import { createResource, type Resource } from "solid-js";
import { useActiveWorkspace } from "@kserp/host-ui";
import type { AvatarAccount } from "../components/AccountAvatar";

interface IndexShape {
  byId: Map<number | string, AvatarAccount>;
  // Display names keyed by id. The server denormalises source/destination
  // names on most reads but the payment-leg history only carries
  // financial_account_id, so callers resolve the name from here instead of
  // showing the bare "Account #N" placeholder.
  nameById: Map<number | string, string>;
}

async function fetchAccountsIndex(wsId: number | null): Promise<IndexShape> {
  const byId = new Map<number | string, AvatarAccount>();
  const nameById = new Map<number | string, string>();
  if (wsId == null) return { byId, nameById };

  const [activeResult, archivedResult] = await Promise.all([
    fetch("/api/financial-accounts?status=active&limit=500", { credentials: "include" })
      .then(async (r) => (r.ok ? ((await r.json()).data ?? []) : []))
      .catch(() => []) as Promise<Array<AvatarAccount>>,
    fetch("/api/financial-accounts?status=archived&limit=500", { credentials: "include" })
      .then(async (r) => (r.ok ? ((await r.json()).data ?? []) : []))
      .catch(() => []) as Promise<Array<AvatarAccount>>,
  ]);

  for (const a of activeResult) {
    byId.set(a.id, {
      id: a.id,
      type: a.type,
      icon: a.icon ?? null,
      color: a.color ?? null,
      s3_link: a.s3_link ?? null,
    });
    if (a.name) nameById.set(a.id, a.name);
  }
  for (const a of archivedResult) {
    if (!byId.has(a.id)) {
      byId.set(a.id, {
        id: a.id,
        type: a.type,
        icon: a.icon ?? null,
        color: a.color ?? null,
        s3_link: a.s3_link ?? null,
      });
    }
    if (a.name && !nameById.has(a.id)) nameById.set(a.id, a.name);
  }
  return { byId, nameById };
}

// Module-level singletons so a page with N rows fires one fetch per org, not
// 2*N. Created on first useAccountsIndex() call.
let sharedResource: Resource<IndexShape> | undefined;

export function useAccountsIndex(): Resource<IndexShape> {
  if (!sharedResource) {
    const { activeWorkspace } = useActiveWorkspace();
    const [data] = createResource(() => activeWorkspace()?.ws_id ?? null, fetchAccountsIndex);
    sharedResource = data;
  }
  return sharedResource;
}

// Build an AvatarAccount for the given id, falling back to a generic
// placeholder when the id is missing from the index (deleted/archived edge
// case, or the index hasn't loaded yet). Always returns something renderable.
export function resolveAccount(
  index: IndexShape | undefined,
  id: number | string | null | undefined,
): AvatarAccount | null {
  if (id == null) return null;
  const hit = index?.byId.get(id);
  if (hit) return hit;
  return { id, type: "external", icon: null, color: null, s3_link: null };
}

// Resolve an account id → its display name. Returns null when the id is
// missing or the index hasn't loaded yet, so callers can fall back to a
// server-supplied name or the bare "Account #N" placeholder.
export function resolveAccountName(
  index: IndexShape | undefined,
  id: number | string | null | undefined,
): string | null {
  if (id == null) return null;
  return index?.nameById.get(id) ?? null;
}
