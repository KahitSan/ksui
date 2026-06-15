// Reference-data + name-resolution layer for the /transactions screen.
// Extracted verbatim from index.tsx. Owns the subcategory taxonomy
// (income/expense lists + counts), the creator stats/name maps, the accounts /
// org-members / shareable-roles lists, and the peers-unavailable flag; plus the
// async loaders (reloadSubcategoryCounts, reloadCreators, loadOrgMembers), the
// onMount that seeds subcategories + counts + creators, the subcategoryOptions
// memo, the creatorName resolver, the creators memo, and the three loader
// createEffects (financial-accounts, roles, members/basic).
//
// The effects/loaders close over nothing from Component(): the accessors they
// read (activeWorkspace, canShare, activeCategories) are threaded in via the deps
// object. Behavior is byte-for-byte identical to the inline version — same
// endpoints, same org-generation staleness guards (activeWorkspace()?.ws_id === gen),
// same graceful-degradation try/catch, same onMount sequencing.
//
// peersUnavailable/setPeersUnavailable are exposed because the DataTable fetchFn
// in index.tsx sets the flag from the list response.

import { createEffect, createMemo, createSignal, onMount } from "solid-js";
import { type FinancialAccount, type OrgMember } from "../lib/types";

export interface TransactionReferenceDataDeps {
  activeWorkspace: () => { ws_id?: string | number | null } | null | undefined;
  canShare: () => boolean;
  activeCategories: () => Set<string>;
}

export function useTransactionReferenceData(deps: TransactionReferenceDataDeps) {
  const { activeWorkspace, canShare, activeCategories } = deps;

  const [incomeSubcategories, setIncomeSubcategories] = createSignal<string[]>([]);
  const [expenseSubcategories, setExpenseSubcategories] = createSignal<string[]>([]);
  const [subcategoryCounts, setSubcategoryCounts] = createSignal<Record<string, number>>({});
  async function reloadSubcategoryCounts() {
    try {
      const r = await fetch("/api/transactions/subcategory-counts", { credentials: "include" });
      if (r.ok) {
        const json = (await r.json()) as { counts: { subcategory: string; count: number }[] };
        const map: Record<string, number> = {};
        for (const c of json.counts || []) map[c.subcategory] = c.count;
        setSubcategoryCounts(map);
      }
    } catch {
      /* nice-to-have */
    }
  }
  // Distinct creator ids + counts from the server (the kernel `user` table is
  // off the plugin's search_path, so /creators returns no names — see GET
  // /creators). Names are resolved reactively via `creatorNameById` (below) and
  // surfaced in the `creators` memo.
  const [creatorStats, setCreatorStats] = createSignal<{ id: string; count?: number }[]>([]);
  // user id -> display name for every creator. Filled from the kernel's
  // /api/users/names so it covers creators who aren't in the caller's org member
  // list (superusers, ex-members, import accounts) — members/basic can't name
  // those. Authenticated, returns only { id, name }.
  const [creatorNameById, setCreatorNameById] = createSignal<Map<string, string>>(new Map());
  async function reloadCreators() {
    try {
      const r = await fetch("/api/transactions/creators", { credentials: "include" });
      if (!r.ok) return;
      const json = (await r.json()) as { creators: { id: string; count: number }[] };
      const stats = json.creators || [];
      setCreatorStats(stats);
      const ids = stats.map((c) => c.id).filter(Boolean);
      if (ids.length === 0) return;
      const nr = await fetch(`/api/users/names?ids=${encodeURIComponent(ids.join(","))}`, {
        credentials: "include",
      });
      if (nr.ok) {
        const nj = (await nr.json()) as { users: { id: string; name: string }[] };
        setCreatorNameById(new Map((nj.users || []).map((u) => [u.id, u.name])));
      }
    } catch {
      /* nice-to-have */
    }
  }
  onMount(async () => {
    try {
      const [inc, exp] = await Promise.all([
        fetch("/api/transactions/subcategories?applies_to=income", { credentials: "include" }).then((r) =>
          r.json(),
        ),
        fetch("/api/transactions/subcategories?applies_to=expense", { credentials: "include" }).then(
          (r) => r.json(),
        ),
      ]);
      setIncomeSubcategories(((inc.subcategories as { name: string }[]) || []).map((s) => s.name));
      setExpenseSubcategories(((exp.subcategories as { name: string }[]) || []).map((s) => s.name));
    } catch {
      /* dropdown stays empty until next refresh */
    }
    await reloadSubcategoryCounts();
    await reloadCreators();
  });
  const subcategoryOptions = createMemo(() => {
    const cats = activeCategories();
    const wantsIncome = cats.has("sale");
    const wantsExpense = cats.has("expense") || cats.has("payable");
    if (wantsIncome && !wantsExpense) return incomeSubcategories();
    if (wantsExpense && !wantsIncome) return expenseSubcategories();
    return [...expenseSubcategories(), ...incomeSubcategories()];
  });

  // Accounts list (for filter dropdowns + the form's account picker).
  const [accounts, setAccounts] = createSignal<FinancialAccount[]>([]);
  const [orgMembers, setOrgMembers] = createSignal<OrgMember[]>([]);
  const [shareableRoles, setShareableRoles] = createSignal<{ code: string; label: string }[]>([]);

  // Set from the list response: which name-resolving peer plugins were absent
  // for the last fetch. Account + payee names resolve over kernel RPC server-
  // side; when a peer is down the row carries no name and we render a ⚠️ marker
  // (see the Accounts/Payee columns) instead of a misleading blank.
  const [peersUnavailable, setPeersUnavailable] = createSignal<{
    accounts: boolean;
    payees: boolean;
  }>({ accounts: false, payees: false });

  // Resolve a transaction's created_by user id to a display name. The server
  // returns only the id (kernel `user` table is off the plugin's search_path —
  // see GET /creators), so names come from the kernel /api/users/names map
  // (covers non-members), falling back to the org member list.
  const creatorName = (userId: string | null | undefined): string | null => {
    if (!userId) return null;
    return (
      creatorNameById().get(userId) ??
      orgMembers().find((m) => m.user_id === userId)?.name ??
      null
    );
  };

  // The "By" filter's options: raw creator ids/counts from the server, with names
  // resolved from the org member list. Recomputes when members load, so labels go
  // from "Unknown" to the real name without a refetch. Ex-members (not in the
  // current member list) stay "Unknown".
  const creators = createMemo(() =>
    creatorStats().map((c) => ({
      id: c.id,
      name: creatorName(c.id) ?? "Unknown",
      count: c.count,
    })),
  );

  createEffect(() => {
    const gen = activeWorkspace()?.ws_id;
    setOrgMembers([]);
    (async () => {
      try {
        const res = await fetch("/api/financial-accounts?limit=200&status=active", {
          credentials: "include",
        });
        if (res.ok && activeWorkspace()?.ws_id === gen) {
          const data = await res.json();
          setAccounts(data.data || []);
        }
      } catch {
        /* financial-accounts plugin may be absent; account picker degrades */
      }
    })();
  });
  createEffect(() => {
    const gen = activeWorkspace()?.ws_id;
    (async () => {
      try {
        const res = await fetch("/api/roles?scope=org", { credentials: "include" });
        if (!res.ok || activeWorkspace()?.ws_id !== gen) return;
        const data = await res.json();
        const rows = (data.data || []) as { code: string; label: string }[];
        setShareableRoles(rows.filter((r) => r.code !== "admin"));
      } catch {
        /* roles endpoint may be absent; role-share buttons degrade */
      }
    })();
  });

  // Load org members for the list's "By" column (created_by → display name).
  // Independent of the share-picker's gated loader below: every viewer of the
  // list needs creator names, not just users who can share. Degrades to initials
  // / "Unknown" when the endpoint is unavailable or forbidden for the role.
  createEffect(() => {
    const gen = activeWorkspace()?.ws_id;
    if (!gen) return;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${gen}/members/basic`, {
          credentials: "include",
        });
        if (res.ok && activeWorkspace()?.ws_id === gen) {
          const data = await res.json();
          setOrgMembers(data.data || data.members || data || []);
        }
      } catch {
        /* members endpoint absent/forbidden; By column degrades to initials */
      }
    })();
  });

  function loadOrgMembers() {
    const wsId = activeWorkspace()?.ws_id;
    if (!wsId || orgMembers().length > 0) return;
    if (!canShare()) return;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${wsId}/members/basic`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setOrgMembers(data.data || data.members || data || []);
        }
      } catch {
        /* members endpoint may be absent; share picker degrades */
      }
    })();
  }

  return {
    accounts,
    orgMembers,
    shareableRoles,
    subcategoryOptions,
    subcategoryCounts,
    creators,
    creatorName,
    peersUnavailable,
    setPeersUnavailable,
    reloadSubcategoryCounts,
    loadOrgMembers,
  };
}
