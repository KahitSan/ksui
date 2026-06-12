// Sales-grouped-by-day lazy-load cluster for the transactions DataTable.
// Extracted verbatim from index.tsx. When the user toggles "group sales by
// day", the table renders synthetic per-day rows; expanding a day lazily
// fetches that day's transactions one page at a time. This hook owns the
// per-day page state (lazyDayData), the expansion set (expandedGroups), the
// loaders, the reset-on-ungroup effect, and the day-expansion JSX.
//
// `groupSalesByDay`'s signal lives in index.tsx (it also feeds the filter
// layer's activeFilterCount/clearAllFilters and the refetch effect — single
// source of truth), so its accessor is threaded in as a param. The filter
// accessors, the columns array, and openDetail are likewise threaded in so the
// hook closes over nothing from Component().

import { createEffect, createSignal, For, Show, type JSX } from "solid-js";
import { type DataTableColumn, type FetchResult } from "@kserp/host-ui";
import { type Transaction } from "../lib/types";
import { type TransactionRow } from "../lib/rows";

interface LazyDayState {
  rows: Transaction[];
  page: number;
  total: number;
  loading: boolean;
  error: string | null;
}

const PER_DAY_LIMIT = 20;

export interface LazyDayGroupsDeps {
  groupSalesByDay: () => boolean;
  tableSearchTerm: () => string;
  statusFilter: () => string;
  subcategoryFilter: () => string;
  accountFilter: () => string;
  createdByFilter: () => string;
  columns: () => DataTableColumn<TransactionRow>[];
  openDetail: (id: number) => void;
}

export function useLazyDayGroups(deps: LazyDayGroupsDeps) {
  const {
    groupSalesByDay,
    tableSearchTerm,
    statusFilter,
    subcategoryFilter,
    accountFilter,
    createdByFilter,
    columns,
    openDetail,
  } = deps;

  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set());
  const [lazyDayData, setLazyDayData] = createSignal<Map<string, LazyDayState>>(new Map());

  async function loadDayPage(dateKey: string, append: boolean): Promise<void> {
    const current = lazyDayData().get(dateKey);
    if (current?.loading) return;
    const nextPage = append ? current!.page + 1 : 1;
    const next: LazyDayState = {
      rows: append ? (current?.rows ?? []) : [],
      page: append ? current!.page : 0,
      total: current?.total ?? 0,
      loading: true,
      error: null,
    };
    setLazyDayData((prev) => {
      const m = new Map(prev);
      m.set(dateKey, next);
      return m;
    });
    try {
      const q = new URLSearchParams({
        page: String(nextPage),
        limit: String(PER_DAY_LIMIT),
        search: tableSearchTerm(),
        sortBy: "transaction_date",
        sortDir: "desc",
        status: statusFilter(),
        category: "sale",
        ...(subcategoryFilter() ? { subcategory: subcategoryFilter() } : {}),
        ...(accountFilter() ? { accountId: accountFilter() } : {}),
        ...(createdByFilter() ? { createdBy: createdByFilter() } : {}),
        dateFrom: dateKey,
        dateTo: dateKey,
      });
      const res = await fetch(`/api/transactions?${q}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const result = (await res.json()) as FetchResult<Transaction>;
      setLazyDayData((prev) => {
        const m = new Map(prev);
        const existing = m.get(dateKey);
        m.set(dateKey, {
          rows: append ? [...(existing?.rows ?? []), ...result.data] : result.data,
          page: nextPage,
          total: result.total,
          loading: false,
          error: null,
        });
        return m;
      });
    } catch (err) {
      setLazyDayData((prev) => {
        const m = new Map(prev);
        const existing = m.get(dateKey);
        m.set(dateKey, {
          rows: existing?.rows ?? [],
          page: existing?.page ?? 0,
          total: existing?.total ?? 0,
          loading: false,
          error: String(err),
        });
        return m;
      });
    }
  }

  function toggleGroupExpanded(dateKey: string) {
    const next = new Set(expandedGroups());
    if (next.has(dateKey)) {
      next.delete(dateKey);
    } else {
      next.add(dateKey);
      const cur = lazyDayData().get(dateKey);
      if (!cur || (cur.rows.length === 0 && !cur.loading)) {
        void loadDayPage(dateKey, false);
      }
    }
    setExpandedGroups(next);
  }

  createEffect(() => {
    if (!groupSalesByDay() && expandedGroups().size > 0) {
      setExpandedGroups(new Set<string>());
      setLazyDayData(new Map());
    }
  });

  function renderDayExpansion(dateKey: string): JSX.Element {
    const state = lazyDayData().get(dateKey);
    if (!state || (state.loading && state.rows.length === 0)) {
      return (
        <div class="p-4 text-xs text-zinc-500" data-testid={`expansion-loading-${dateKey}`}>
          Loading transactions for this day…
        </div>
      );
    }
    if (state.error && state.rows.length === 0) {
      return (
        <div class="p-4 text-xs text-rose-400 flex items-center gap-3">
          <span>Failed to load transactions for this day.</span>
          <button type="button" class="underline" onClick={() => void loadDayPage(dateKey, false)}>
            Retry
          </button>
        </div>
      );
    }
    return (
      <div class="max-h-96 overflow-y-auto" data-testid={`expansion-panel-${dateKey}`}>
        <table class="w-full text-left text-sm">
          <tbody>
            <For each={state.rows}>
              {(sub) => (
                <tr
                  class="border-t border-zinc-800/30 hover:bg-zinc-800/40 cursor-pointer"
                  onClick={() => openDetail(sub.id)}
                  data-testid={`expansion-subrow-${sub.id}`}
                >
                  <For each={columns()}>
                    {(col) => (
                      <td class={`px-4 py-2 ${col.className || ""}`}>
                        {col.render
                          ? col.render(
                              col.data
                                ? (sub[col.data as keyof Transaction] as
                                    | TransactionRow[keyof TransactionRow]
                                    | null)
                                : null,
                              "display",
                              { ...sub, _isSubrow: true } as TransactionRow,
                              { row: 0, col: 0, search: "" },
                            )
                          : String(col.data ? ((sub[col.data as keyof Transaction] as unknown) ?? "") : "")}
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={state.rows.length < state.total}>
          <div class="border-t border-zinc-800/30 p-2 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
            <span>
              Showing {state.rows.length} of {state.total}
            </span>
            <button
              type="button"
              data-testid={`day-show-more-${dateKey}`}
              disabled={state.loading}
              onClick={() => void loadDayPage(dateKey, true)}
              class="rounded-lg border border-zinc-800/50 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-amber-500/40 hover:text-amber-400 disabled:opacity-50"
            >
              {state.loading ? "Loading…" : "Show more"}
            </button>
          </div>
        </Show>
      </div>
    );
  }

  return {
    expandedGroups,
    lazyDayData,
    setLazyDayData,
    loadDayPage,
    toggleGroupExpanded,
    renderDayExpansion,
  };
}
