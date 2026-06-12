// Filter-state layer for the /transactions screen.
// Extracted verbatim from index.tsx. Owns ALL_CATEGORIES, every filter signal
// (categories/status/account/subcategory/createdBy/search/tableSearch/pdc),
// the categoryFilterParam accessor, the activeFilterCount memo, clearAllFilters,
// and the defer:true on(...) effect that fires resetAndRefetch on any filter
// change.
//
// groupSalesByDay participates in activeFilterCount/clearAllFilters and the
// refetch effect, but its signal lives outside this hook (index.tsx, shared
// with useLazyDayGroups) — it is threaded in via deps to keep a single source
// of truth. resetAndRefetch is likewise threaded (the DataTable api accessor in
// index.tsx). Behavior is byte-for-byte identical to the inline version: same
// activeFilterCount arithmetic, same clear-all reset values, same defer-true
// on-effect tracking set.

import { createEffect, createMemo, createSignal, on } from "solid-js";

export interface TransactionFiltersDeps {
  resetAndRefetch: () => void;
  groupSalesByDay: () => boolean;
  setGroupSalesByDay: (next: boolean) => void;
}

export function useTransactionFilters(deps: TransactionFiltersDeps) {
  const { resetAndRefetch, groupSalesByDay, setGroupSalesByDay } = deps;

  const ALL_CATEGORIES = ["expense", "sale", "business", "payable"] as const;

  const [activeCategories, setActiveCategories] = createSignal<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = createSignal("active");
  const [accountFilter, setAccountFilter] = createSignal("");
  const [subcategoryFilter, setSubcategoryFilter] = createSignal("");
  const [createdByFilter, setCreatedByFilter] = createSignal("");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [tableSearchTerm, setTableSearchTerm] = createSignal("");
  const [pdcFilter, setPdcFilter] = createSignal<Set<string>>(new Set());

  const categoryFilterParam = () => {
    const cats = activeCategories();
    if (cats.size === 0 || cats.size === ALL_CATEGORIES.length) return "";
    return Array.from(cats).join(",");
  };

  const activeFilterCount = createMemo(
    () =>
      (searchQuery() ? 1 : 0) +
      activeCategories().size +
      pdcFilter().size +
      (accountFilter() ? 1 : 0) +
      (subcategoryFilter() ? 1 : 0) +
      (createdByFilter() ? 1 : 0) +
      (statusFilter() !== "active" ? 1 : 0) +
      (groupSalesByDay() ? 1 : 0),
  );

  function clearAllFilters() {
    setActiveCategories(new Set<string>());
    setPdcFilter(new Set<string>());
    setAccountFilter("");
    setSubcategoryFilter("");
    setCreatedByFilter("");
    setSearchQuery("");
    setStatusFilter("active");
    setGroupSalesByDay(false);
  }

  createEffect(
    on(
      () => ({
        type: activeCategories(),
        pdc: pdcFilter(),
        status: statusFilter(),
        account: accountFilter(),
        subcategory: subcategoryFilter(),
        createdBy: createdByFilter(),
        group: groupSalesByDay(),
      }),
      () => {
        resetAndRefetch();
      },
      { defer: true },
    ),
  );

  return {
    activeCategories,
    setActiveCategories,
    statusFilter,
    setStatusFilter,
    accountFilter,
    setAccountFilter,
    subcategoryFilter,
    setSubcategoryFilter,
    createdByFilter,
    setCreatedByFilter,
    searchQuery,
    setSearchQuery,
    tableSearchTerm,
    setTableSearchTerm,
    pdcFilter,
    setPdcFilter,
    categoryFilterParam,
    activeFilterCount,
    clearAllFilters,
  };
}
