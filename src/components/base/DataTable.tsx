// Source: kserp src/components/ui/DataTable/DataTable.tsx (the host's Tailwind-
// classed table). Ported into ksui as a DOMAIN-FREE base primitive: a
// server-side (fetchFn) OR client-side (data) table with debounced search,
// column sort, pagination / "Show more" load mode, a filters JSX slot, an
// optional date filter, per-row expansion, and an onRefetch handle exposing
// { refetch, resetAndRefetch }.
//
// Like Button / Modal, ksui ships no sidecar .css — every Tailwind utility the
// host used is reproduced here as a runtime <style> tag (a stable id, injected
// once per page) referenced with plain, unscoped `ksui-datatable-*` class
// names. Surface / border / accent colors read from CSS custom properties
// (`--ksui-dt-*`) with the host's dark zinc + amber values as fallbacks, so a
// consumer can retint without forking. The component depends only on solid-js +
// lucide-solid plus ksui's own DatePicker — the same self-contained calendar
// popover the host DataTable used for its date filter (single + range), so the
// library carries no host primitive and no native `<input type="date">`.
//
// The public type surface (DataTableRow / DataTableColumn / FetchResult /
// FetchParams / DataTableProps) mirrors the kernel's `@kserp/host-ui` ambient
// contract EXACTLY, so a caller written against host-ui works unchanged here.
//
// Composition note: the date filter renders ksui's own `DatePicker` (a sibling
// base component) instead of a native `<input type="date">`, mirroring how the
// host DataTable wired its DatePicker. Importing one base into another technically
// makes this a composite under CONTRIBUTING's base/composite split; it stays in
// `base/` (and is re-exported as base) to preserve its existing import path —
// the only ksui dependency is DatePicker, itself a self-contained primitive.

import {
  batch,
  createSignal,
  createMemo,
  createEffect,
  on,
  untrack,
  For,
  Show,
  type JSX,
  type ParentComponent,
} from "solid-js";
import Search from "lucide-solid/icons/search";
import Filter from "lucide-solid/icons/filter";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import DatePicker from "./DatePicker";

// ---------------------------------------------------------------------------
// Injected CSS
// ---------------------------------------------------------------------------

const STYLE_ID = "ksui-datatable-style";

// ---------------------------------------------------------------------------
// Theming
// ---------------------------------------------------------------------------
//
// Every color in the injected stylesheet is driven by a `--ksui-dt-*` CSS
// custom property; the fallback after each `var(...)` is the host kserp
// DataTable's exact value (resolved from its Tailwind classes — zinc/amber
// dark theme). To retint, wrap the table in a container that sets the vars,
// e.g. `<div style={{ "--ksui-dt-card-bg": "#000", "--ksui-dt-accent": "#0af" }}>`.
//
// Full list of overridable vars (default = host value):
//   --ksui-dt-card-bg      outer card background
//                          (host `.card-bg`: linear-gradient(135deg,#0f0f0f,#1a1a1a))
//   --ksui-dt-radius       outer card / control corner radius   (0.5rem)
//   --ksui-dt-border       card / header / footer / control border (zinc-800/50, rgba(39,39,42,0.5))
//   --ksui-dt-row-border   row divider + expansion-row top border (zinc-800/30, rgba(39,39,42,0.3))
//   --ksui-dt-control-bg   filter button / menu / select / search / show-more bg (zinc-900, #18181b)
//                          (the date filter is the ksui DatePicker; it reads the same vars)
//   --ksui-dt-fg           primary text: row/search text (zinc-200, #e4e4e7)
//   --ksui-dt-fg-strong    hover-to-full-contrast text on controls/pager (white, #ffffff)
//   --ksui-dt-text         secondary text: filter btn / select / pager nums+arrows (zinc-400, #a1a1aa)
//   --ksui-dt-text-strong  show-more label + sortable-header hover (zinc-300, #d4d4d8)
//   --ksui-dt-muted        header th / search icon+placeholder / empty / info text (zinc-500, #71717a)
//   --ksui-dt-faint        sort caret / per-row date separator / pager ellipsis (zinc-600, #52525b)
//   --ksui-dt-row-hover    row hover + pager hover bg (zinc-800/50, rgba(39,39,42,0.5))
//   --ksui-dt-row-active   row :active bg (zinc-800/70, rgba(39,39,42,0.7))
//   --ksui-dt-expansion-bg per-row expansion panel bg (zinc-950/40, rgba(9,9,11,0.4))
//   --ksui-dt-skeleton     loading skeleton shimmer bg (zinc-800/50, rgba(39,39,42,0.5))
//   --ksui-dt-accent       active accent text: active pager num / show-more hover (amber-400, #fbbf24)
//   --ksui-dt-accent-bg    active pager num bg (amber-600/20, rgba(217,119,6,0.2))
//   --ksui-dt-accent-border focus/hover accent border: search focus, show-more hover (amber-500/40, rgba(245,158,11,0.4))
//
const DATATABLE_CSS = `
.ksui-datatable{background:var(--ksui-dt-card-bg,linear-gradient(135deg,#0f0f0f 0%,#1a1a1a 100%));border:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));border-radius:var(--ksui-dt-radius,0.5rem);color:var(--ksui-dt-fg,#e4e4e7);}
.ksui-datatable-header{display:flex;flex-wrap:wrap;align-items:center;gap:0.75rem;border-bottom:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));padding:1rem;}
.ksui-datatable-filters-inline{display:none;flex:1 1 0%;}
.ksui-datatable-filters-mobile{display:block;flex:1 1 0%;}
@media (min-width:768px){.ksui-datatable-filters-inline{display:block;}.ksui-datatable-filters-mobile{display:none;}}
.ksui-datatable-spacer{flex:1 1 0%;}
.ksui-datatable-controls{display:flex;align-items:center;gap:0.5rem;}
.ksui-datatable-filter-toggle-wrap{position:relative;}
.ksui-datatable-filter-toggle{display:inline-flex;cursor:pointer;align-items:center;gap:0.5rem;border-radius:0.5rem;border:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));background:var(--ksui-dt-control-bg,#18181b);padding:0.5rem 0.75rem;font-size:0.75rem;line-height:1rem;color:var(--ksui-dt-text,#a1a1aa);transition:color 0.15s ease;}
.ksui-datatable-filter-toggle:hover{color:var(--ksui-dt-fg-strong,#ffffff);}
.ksui-datatable-filter-menu{position:absolute;left:0;top:100%;z-index:50;margin-top:0.5rem;border-radius:0.5rem;border:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));background:var(--ksui-dt-control-bg,#18181b);padding:0.75rem;box-shadow:0 20px 25px -5px rgba(0,0,0,0.4),0 8px 10px -6px rgba(0,0,0,0.4);}
.ksui-datatable-select{border-radius:0.375rem;border:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));background:var(--ksui-dt-control-bg,#18181b);padding:0.5rem;font-size:0.75rem;line-height:1rem;color:var(--ksui-dt-text,#a1a1aa);}
.ksui-datatable-search-wrap{position:relative;}
.ksui-datatable-search-icon{position:absolute;left:0.75rem;top:50%;transform:translateY(-50%);color:var(--ksui-dt-muted,#71717a);pointer-events:none;}
.ksui-datatable-search-input{width:100%;border-radius:0.5rem;border:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));background:var(--ksui-dt-control-bg,#18181b);padding:0.5rem 1rem 0.5rem 2.25rem;font-size:0.875rem;line-height:1.25rem;color:var(--ksui-dt-fg,#e4e4e7);outline:none;transition:border-color 0.15s ease;}
.ksui-datatable-search-input::placeholder{color:var(--ksui-dt-muted,#71717a);}
.ksui-datatable-search-input:focus{border-color:var(--ksui-dt-accent-border,rgba(245,158,11,0.4));}
@media (min-width:640px){.ksui-datatable-search-input{width:18rem;}}
.ksui-datatable-scroll{overflow-x:auto;transition:opacity 0.15s ease;}
.ksui-datatable-table{width:100%;text-align:left;font-size:0.875rem;line-height:1.25rem;border-collapse:collapse;}
.ksui-datatable-thead{border-bottom:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--ksui-dt-muted,#71717a);}
.ksui-datatable-th{padding:0.75rem 1rem;}
.ksui-datatable-th-sortable{cursor:pointer;transition:color 0.15s ease;}
.ksui-datatable-th-sortable:hover{color:var(--ksui-dt-text-strong,#d4d4d8);}
.ksui-datatable-th-inner{display:inline-flex;align-items:center;}
.ksui-datatable-sort-icon{margin-left:0.25rem;display:inline-flex;color:var(--ksui-dt-faint,#52525b);}
.ksui-datatable-row{border-top:1px solid var(--ksui-dt-row-border,rgba(39,39,42,0.3));transition:background-color 0.15s ease;}
.ksui-datatable-row:hover{background-color:var(--ksui-dt-row-hover,rgba(39,39,42,0.5));}
.ksui-datatable-row-clickable{cursor:pointer;}
.ksui-datatable-row-clickable:active{background-color:var(--ksui-dt-row-active,rgba(39,39,42,0.7));}
.ksui-datatable-td{padding:0.75rem 1rem;}
.ksui-datatable-expansion-row{border-top:1px solid var(--ksui-dt-row-border,rgba(39,39,42,0.3));background-color:var(--ksui-dt-expansion-bg,rgba(9,9,11,0.4));}
.ksui-datatable-expansion-td{padding:0;}
.ksui-datatable-skeleton{height:1.25rem;width:100%;border-radius:0.25rem;background:var(--ksui-dt-skeleton,rgba(39,39,42,0.5));animation:ksuiDatatablePulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite;}
@keyframes ksuiDatatablePulse{0%,100%{opacity:1;}50%{opacity:0.5;}}
.ksui-datatable-empty{padding:3rem 1rem;text-align:center;color:var(--ksui-dt-muted,#71717a);}
.ksui-datatable-footer{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));padding:1rem;}
.ksui-datatable-info{font-size:0.75rem;color:var(--ksui-dt-muted,#71717a);}
.ksui-datatable-showmore{border-radius:0.5rem;border:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));background:var(--ksui-dt-control-bg,#18181b);padding:0.5rem 1rem;font-size:0.75rem;font-weight:500;color:var(--ksui-dt-text-strong,#d4d4d8);transition:border-color 0.15s ease,color 0.15s ease;cursor:pointer;}
.ksui-datatable-showmore:hover:not(:disabled){border-color:var(--ksui-dt-accent-border,rgba(245,158,11,0.4));color:var(--ksui-dt-accent,#fbbf24);}
.ksui-datatable-showmore:disabled{cursor:not-allowed;opacity:0.5;}
.ksui-datatable-pager{display:flex;align-items:center;gap:0.25rem;}
.ksui-datatable-pager-arrow{border-radius:0.25rem;padding:0.375rem;color:var(--ksui-dt-text,#a1a1aa);transition:background-color 0.15s ease,color 0.15s ease;background:transparent;border:0;cursor:pointer;display:inline-flex;}
.ksui-datatable-pager-arrow:hover:not(:disabled){background-color:var(--ksui-dt-row-hover,rgba(39,39,42,0.5));color:var(--ksui-dt-fg-strong,#ffffff);}
.ksui-datatable-pager-arrow:disabled{cursor:not-allowed;opacity:0.3;}
.ksui-datatable-pager-num{border-radius:0.25rem;padding:0.25rem 0.625rem;font-size:0.75rem;color:var(--ksui-dt-text,#a1a1aa);transition:background-color 0.15s ease,color 0.15s ease;background:transparent;border:0;cursor:pointer;}
.ksui-datatable-pager-num:hover{background-color:var(--ksui-dt-row-hover,rgba(39,39,42,0.5));color:var(--ksui-dt-fg-strong,#ffffff);}
.ksui-datatable-pager-num-active{background-color:var(--ksui-dt-accent-bg,rgba(217,119,6,0.2));font-weight:500;color:var(--ksui-dt-accent,#fbbf24);}
.ksui-datatable-pager-num-active:hover{background-color:var(--ksui-dt-accent-bg,rgba(217,119,6,0.2));color:var(--ksui-dt-accent,#fbbf24);}
.ksui-datatable-pager-ellipsis{padding:0 0.375rem;font-size:0.75rem;color:var(--ksui-dt-faint,#52525b);}
`;

function ensureDataTableStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = DATATABLE_CSS;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// Types (mirror the kernel's @kserp/host-ui contract exactly)
// ---------------------------------------------------------------------------

export interface DataTableRow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface DataTableColumn<T extends DataTableRow> {
  /** Property key on the row object. null for computed/action columns. */
  data: (keyof T & string) | null;
  title?: string;
  render?: (
    data: T[keyof T] | null,
    type: "display",
    row: T,
    meta: { row: number; col: number; search: string },
  ) => JSX.Element | string;
  orderable?: boolean;
  className?: string;
}

/** Generic fetch result returned by fetchFn */
export interface FetchResult<T> {
  data: T[];
  total: number;
}

/** Parameters passed to fetchFn */
export interface FetchParams {
  page: number;
  limit: number;
  search: string;
  sortBy: string | null;
  sortDir: "asc" | "desc";
  /**
   * ISO date string (YYYY-MM-DD) when single-date `dateField` filtering is active.
   * Null when range mode is active (use `dateFrom` / `dateTo` instead) or no filter is set.
   */
  dateFilter: string | null;
  /** ISO start date when `dateRangeMode` is on. Null when range mode is off or unset. */
  dateFrom?: string | null;
  /** ISO end date when `dateRangeMode` is on. Null when range mode is off or unset. */
  dateTo?: string | null;
}

export interface DataTableProps<T extends DataTableRow> {
  /**
   * Generic data fetcher. Return { data, total }.
   * When provided, the table runs in server-side mode automatically.
   */
  fetchFn?: (params: FetchParams) => Promise<FetchResult<T>>;

  /** Static data (client-side mode). Ignored when fetchFn is set. */
  data?: T[];

  columns?: DataTableColumn<T>[];

  /**
   * Reactive key that triggers a refetch + page-1 reset when it changes.
   * Typical usage: `refetchKey={() => activeWorkspace()?.ws_id}`.
   */
  refetchKey?: () => unknown;

  searching?: boolean;
  ordering?: boolean;
  paging?: boolean;
  info?: boolean;

  pageLength?: number;
  lengthMenu?: number[];

  /** Search input placeholder */
  searchPlaceholder?: string;

  /**
   * Replace the paginated footer with a "Show more" button. Fetched chunks
   * accumulate into the table instead of replacing each other. When a chunk
   * comes back with fewer rows than `pageLength` (e.g. the consumer's fetchFn
   * collapses or filters rows post-fetch) and there is more data on the
   * server, the table auto-loads the next chunk up to a small cap; after
   * that the user clicks Show more to keep going. Default false: paginate
   * normally.
   */
  loadMore?: boolean;

  /** Class for the outer container */
  class?: string;

  /** Debounce delay in ms for search input (default 300) */
  debounceDelay?: number;

  /** Empty state message */
  emptyMessage?: string;

  /** No-results message (when search returns 0) */
  noResultsMessage?: string;

  /** Content rendered inside the card above the header bar (e.g. filter buttons) */
  filters?: JSX.Element;

  /** Column key containing date values. Enables a date input to filter by date. */
  dateField?: keyof T & string;

  /**
   * Switch the date filter to range mode. When true, the date control picks a
   * start/end pair, and `fetchFn` receives `dateFrom` / `dateTo` instead of a single
   * `dateFilter`. Requires `dateField` to be set.
   */
  dateRangeMode?: boolean;

  /**
   * Optional pre-render transform applied to the accumulated table data.
   * Runs over the fetched rows in a memo, so its output recomputes whenever
   * the underlying rows change OR the transform's reactive dependencies
   * (signals it reads) change, without re-invoking `fetchFn`.
   */
  transformRows?: (rows: T[]) => T[];

  /** Called when data is refreshed (after fetch completes) */
  onDataChange?: (data: T[]) => void;

  /**
   * Expose a refetch function to parent. The callback receives an object
   * with two members:
   *   - `refetch()` triggers a fresh fetch with the current page/state.
   *   - `resetAndRefetch()` resets pagination state (page -> 1, loadMore
   *     accumulators cleared, fetch-dedupe cache cleared) and then fetches
   *     page 1.
   */
  onRefetch?: (api: { refetch: () => void; resetAndRefetch: () => void }) => void;

  /** Called when a data row is clicked */
  onRowClick?: (row: T) => void;

  /**
   * Optional per-row expansion panel. Returns a JSX node to render inside a
   * full-width row directly under the main row, or null/undefined to skip.
   * The expansion row spans every column.
   */
  expansionContent?: (row: T) => JSX.Element | null | undefined;
}

// Mobile filter dropdown -- collapses the filter slot into a toggle menu.
const FilterDropdown: ParentComponent = (props) => {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="ksui-datatable-filter-toggle-wrap">
      <button onClick={() => setOpen(!open())} class="ksui-datatable-filter-toggle">
        <Filter size={14} />
        Filter
      </button>
      <Show when={open()}>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div class="ksui-datatable-filter-menu" onClick={() => setOpen(false)}>
          {props.children}
        </div>
      </Show>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataTable<T extends DataTableRow>(props: DataTableProps<T>): JSX.Element {
  ensureDataTableStyle();

  const columns = () => props.columns || [];
  const searching = () => props.searching ?? true;
  const ordering = () => props.ordering ?? true;
  const paging = () => props.paging ?? true;
  const info = () => props.info ?? true;
  const pageLength = () => props.pageLength ?? 10;
  const lengthMenu = () => props.lengthMenu ?? [10, 25, 50, 100];
  const className = () => props.class || "";
  const debounceDelay = () => props.debounceDelay ?? 300;
  const isServerSide = () => !!props.fetchFn;
  const loadMoreMode = () => props.loadMore === true;

  // State
  const [searchTerm, setSearchTerm] = createSignal("");
  const [currentPage, setCurrentPage] = createSignal(1);
  const [itemsPerPage, setItemsPerPage] = createSignal(pageLength());
  const [sortBy, setSortBy] = createSignal<string | null>(null);
  const [sortDir, setSortDir] = createSignal<"asc" | "desc">("desc");
  const [dateFilter, setDateFilter] = createSignal<string | null>(null);
  const [dateFrom, setDateFrom] = createSignal<string | null>(null);
  const [dateTo, setDateTo] = createSignal<string | null>(null);

  const [tableData, setTableData] = createSignal<T[]>([]);
  const [totalRecords, setTotalRecords] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [initialized, setInitialized] = createSignal(false);

  // ---- Server-side fetching ----

  let debounceTimer: ReturnType<typeof setTimeout>;
  // (page, epoch) tuples this DataTable has already started a fetch for in
  // loadMore mode. A second effect run with the same key skips entirely so
  // the chunk is never appended twice. Reset on every resetLoadMore() call.
  const processedFetchKeys = new Set<string>();
  const [fetchTrigger, setFetchTrigger] = createSignal(0);
  // Number of API records consumed across all chunks since the last reset.
  const [apiConsumed, setApiConsumed] = createSignal(0);
  // Auto-load attempts since the last reset, capped to keep a degenerate
  // grouping from hammering the API.
  const [autoLoadCount, setAutoLoadCount] = createSignal(0);
  // Monotonic id bumped on every reset; each fetch closes over the epoch active
  // at request time and discards itself on completion if the epoch moved on.
  const [loadEpoch, setLoadEpoch] = createSignal(0);
  // Visible-row target the auto-load chain works toward.
  const [loadTarget, setLoadTarget] = createSignal(pageLength());
  // True between a manual Show-more click and the moment its fetch returns.
  const [pendingLoadTargetBump, setPendingLoadTargetBump] = createSignal(false);
  const AUTO_LOAD_CAP = 5;

  function triggerFetch() {
    setFetchTrigger((n) => n + 1);
  }

  function resetLoadMore() {
    if (!loadMoreMode()) return;
    processedFetchKeys.clear();
    setAutoLoadCount(0);
    setApiConsumed(0);
    // Also clear totalRecords so the auto-load effect doesn't fire between this
    // reset and the next fetch's response.
    setTotalRecords(0);
    setLoadTarget(itemsPerPage());
    setPendingLoadTargetBump(false);
    setLoadEpoch((e) => e + 1);
  }

  // Expose refetch to parent
  props.onRefetch?.({
    refetch: () => triggerFetch(),
    resetAndRefetch: () => {
      batch(() => {
        setCurrentPage(1);
        resetLoadMore();
        triggerFetch();
      });
    },
  });

  // Watch refetchKey — when it changes, reset to page 1 and refetch.
  createEffect(
    on(
      () => props.refetchKey?.(),
      () => {
        batch(() => {
          setCurrentPage(1);
          resetLoadMore();
          triggerFetch();
        });
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    void fetchTrigger(); // track
    if (!props.fetchFn) return;

    const fn = props.fetchFn;
    const limit = itemsPerPage();
    const lm = loadMoreMode();
    const page = currentPage();
    const epoch = loadEpoch();
    const params: FetchParams = {
      page,
      limit,
      search: searchTerm(),
      sortBy: sortBy(),
      sortDir: sortDir(),
      dateFilter: props.dateRangeMode ? null : dateFilter(),
      dateFrom: props.dateRangeMode ? dateFrom() : null,
      dateTo: props.dateRangeMode ? dateTo() : null,
    };

    if (lm) {
      const key = `${page}:${epoch}`;
      if (processedFetchKeys.has(key)) return;
      processedFetchKeys.add(key);
    }

    setLoading(true);
    fn(params)
      .then((result) => {
        // In loadMore mode, drop a stale response if the user has reset
        // (search/sort/filter) while this fetch was in flight.
        if (lm && epoch !== loadEpoch()) {
          return;
        }
        if (lm && page > 1) {
          // Append next chunk
          setTableData((prev) => [...(prev as T[]), ...(result.data as T[])] as T[]);
        } else {
          // Replace (paginated mode, or first chunk in loadMore)
          setTableData(result.data as T[]);
        }
        setTotalRecords(result.total);
        if (lm) {
          setApiConsumed((prev) => Math.min(prev + limit, result.total));
          if (page > 1 && untrack(pendingLoadTargetBump)) {
            setLoadTarget((t) => t + itemsPerPage());
            setPendingLoadTargetBump(false);
          }
        }
        setInitialized(true);
        props.onDataChange?.(result.data);
      })
      .catch((err) => {
        console.error("[DataTable] fetch error:", err);
        if (!lm || page === 1) {
          setTableData([]);
          setTotalRecords(0);
          return;
        }
        // page > 1 failure in loadMore mode: rewind so a retry can re-fetch
        // the same page.
        if (epoch === loadEpoch()) {
          processedFetchKeys.delete(`${page}:${epoch}`);
          setCurrentPage((p) => (p > 1 ? p - 1 : p));
        }
      })
      .finally(() => setLoading(false));
  });

  // ---- Auto-load (loadMore mode) ----
  //
  // Fires only when a freshly fetched server chunk left us short of the
  // visible-row target. Gated on `apiConsumed` (raw rows the server has handed
  // us so far) — NOT on `paginatedData().length`, the post-transform visible
  // count — so a transformRows-driven shrink in the visible list never fires a
  // network fetch. The autoLoadCount cap protects a degenerate grouping from
  // chaining to the end of the dataset.
  createEffect(
    on([apiConsumed, loading], ([, isLoading]) => {
      if (!loadMoreMode()) return;
      if (untrack(initialized) === false) return;
      if (isLoading) return;
      const visible = untrack(() => paginatedData().length);
      if (visible >= untrack(loadTarget)) return;
      if (untrack(apiConsumed) >= untrack(totalRecords)) return;
      if (untrack(autoLoadCount) >= AUTO_LOAD_CAP) return;
      batch(() => {
        setAutoLoadCount((c) => c + 1);
        setCurrentPage((p) => p + 1);
        triggerFetch();
      });
    }),
  );

  // ---- Client-side data ----

  createEffect(() => {
    if (isServerSide()) return;
    const d = props.data || [];
    setTableData(d as T[]);
    setTotalRecords(d.length);
    setInitialized(true);
  });

  // Post-fetch row transform. No-op passthrough when no transform is supplied.
  const transformedData = createMemo(() => {
    const transform = props.transformRows;
    const rows = tableData() as T[];
    return transform ? transform(rows) : rows;
  });

  // Client-side date filtering
  const dateFilteredData = createMemo(() => {
    if (isServerSide()) return transformedData();
    const field = props.dateField;
    if (!field) return transformedData();
    if (props.dateRangeMode) {
      const from = dateFrom();
      const to = dateTo();
      if (!from && !to) return transformedData();
      return transformedData().filter((row) => {
        const val = row[field];
        if (!val) return false;
        const day = String(val).slice(0, 10);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      });
    }
    const df = dateFilter();
    if (!df) return transformedData();
    return transformedData().filter((row) => {
      const val = row[field];
      if (!val) return false;
      return String(val).startsWith(df);
    });
  });

  // Client-side search filtering
  const filteredData = createMemo(() => {
    if (isServerSide()) return dateFilteredData();
    if (!searching() || !searchTerm()) return dateFilteredData();
    const q = searchTerm().toLowerCase();
    return dateFilteredData().filter((row) =>
      Object.values(row).some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(q),
      ),
    );
  });

  // Client-side sorting
  const sortedData = createMemo(() => {
    if (isServerSide()) return filteredData();
    const key = sortBy();
    if (!ordering() || !key) return filteredData();
    const dir = sortDir();
    return [...filteredData()].sort((a, b) => {
      const av = a[key],
        bv = b[key];
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
  });

  // Client-side pagination
  const paginatedData = createMemo(() => {
    if (isServerSide() || !paging()) return sortedData();
    const start = (currentPage() - 1) * itemsPerPage();
    return sortedData().slice(start, start + itemsPerPage());
  });

  const displayTotal = createMemo(() => (isServerSide() ? totalRecords() : sortedData().length));

  const totalPages = createMemo(() => Math.ceil(displayTotal() / itemsPerPage()) || 1);

  // ---- Handlers ----

  function handleDateFilter(date: string | null) {
    batch(() => {
      setDateFilter(date);
      setCurrentPage(1);
      resetLoadMore();
      if (isServerSide()) triggerFetch();
    });
  }

  function handleDateRangeFilter(range: { start: string | null; end: string | null }) {
    batch(() => {
      setDateFrom(range.start);
      setDateTo(range.end);
      setCurrentPage(1);
      resetLoadMore();
      if (isServerSide()) triggerFetch();
    });
  }

  function handleSearch(value: string) {
    batch(() => {
      setSearchTerm(value);
      setCurrentPage(1);
      resetLoadMore();
    });
    if (isServerSide()) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(triggerFetch, debounceDelay());
    }
  }

  function handleSort(key: string) {
    if (!ordering()) return;
    batch(() => {
      if (sortBy() === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortBy(key);
        setSortDir("desc");
      }
      setCurrentPage(1);
      resetLoadMore();
      if (isServerSide()) triggerFetch();
    });
  }

  function handlePageChange(page: number) {
    setCurrentPage(page);
    if (isServerSide()) triggerFetch();
  }

  function handlePageSize(size: number) {
    batch(() => {
      setItemsPerPage(size);
      setCurrentPage(1);
      resetLoadMore();
      if (isServerSide()) triggerFetch();
    });
  }

  function handleShowMore() {
    if (!loadMoreMode() || loading()) return;
    if (apiConsumed() >= totalRecords()) return;
    batch(() => {
      setCurrentPage((p) => p + 1);
      setAutoLoadCount(0);
      setPendingLoadTargetBump(true);
      triggerFetch();
    });
  }

  // ---- Render helpers ----

  function renderCell(col: DataTableColumn<T>, row: T, rowIdx: number): JSX.Element | string {
    if (col.render) {
      const val = col.data ? row[col.data] : null;
      return col.render(val, "display", row, {
        row: rowIdx,
        col: columns().indexOf(col),
        search: searchTerm(),
      });
    }
    return String(col.data ? (row[col.data] ?? "") : "");
  }

  function getHeader(col: DataTableColumn<T>) {
    if (col.title) return col.title;
    if (col.data) return col.data.charAt(0).toUpperCase() + col.data.slice(1);
    return "";
  }

  function isSortable(col: DataTableColumn<T>) {
    return ordering() && col.orderable !== false && col.data !== null;
  }

  function pageNumbers(): (number | "...")[] {
    const tp = totalPages();
    const cp = currentPage();
    if (tp <= 7) return Array.from({ length: tp }, (_, i) => i + 1);
    const pages: (number | "...")[] = [1];
    if (cp > 3) pages.push("...");
    for (let i = Math.max(2, cp - 1); i <= Math.min(tp - 1, cp + 1); i++) pages.push(i);
    if (cp < tp - 2) pages.push("...");
    pages.push(tp);
    return pages;
  }

  // ---- JSX ----

  return (
    <div class={`ksui-datatable ${className()}`}>
      {/* Header bar: filters + date + per-page + search in one row */}
      <Show when={props.filters || searching() || paging()}>
        <div class="ksui-datatable-header">
          {/* Filters: inline on md+, dropdown on mobile */}
          <Show when={props.filters}>
            <div class="ksui-datatable-filters-inline">{props.filters}</div>
            <div class="ksui-datatable-filters-mobile">
              <FilterDropdown>{props.filters}</FilterDropdown>
            </div>
          </Show>
          <Show when={!props.filters}>
            <div class="ksui-datatable-spacer" />
          </Show>

          {/* Right side: date filter + per-page + search */}
          <div class="ksui-datatable-controls">
            <Show when={props.dateField && !props.dateRangeMode}>
              <DatePicker value={dateFilter()} onChange={handleDateFilter} />
            </Show>
            <Show when={props.dateField && props.dateRangeMode}>
              <DatePicker
                range={true}
                value={{ start: dateFrom(), end: dateTo() }}
                onChange={handleDateRangeFilter}
              />
            </Show>
            <Show when={paging() && lengthMenu().length > 1}>
              <select
                value={itemsPerPage()}
                onChange={(e) => handlePageSize(Number(e.currentTarget.value))}
                class="ksui-datatable-select"
              >
                <For each={lengthMenu()}>
                  {(size) => <option value={size}>{size} per page</option>}
                </For>
              </select>
            </Show>
            <Show when={searching()}>
              <div class="ksui-datatable-search-wrap">
                <Search size={16} class="ksui-datatable-search-icon" />
                <input
                  type="text"
                  placeholder={props.searchPlaceholder || "Search..."}
                  value={searchTerm()}
                  onInput={(e) => handleSearch(e.currentTarget.value)}
                  class="ksui-datatable-search-input"
                />
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Table */}
      <div
        class="ksui-datatable-scroll"
        style={{ opacity: loading() && initialized() ? 0.5 : 1 }}
      >
        <table class="ksui-datatable-table">
          <thead class="ksui-datatable-thead">
            <tr>
              <For each={columns()}>
                {(col) => (
                  <th
                    class={`ksui-datatable-th ${isSortable(col) ? "ksui-datatable-th-sortable" : ""} ${col.className || ""}`}
                    onClick={() => isSortable(col) && col.data && handleSort(col.data)}
                  >
                    <span class="ksui-datatable-th-inner">
                      {getHeader(col)}
                      <Show when={isSortable(col)}>
                        <span class="ksui-datatable-sort-icon">
                          <Show
                            when={sortBy() === col.data}
                            fallback={<ChevronsUpDown size={12} />}
                          >
                            <Show when={sortDir() === "asc"} fallback={<ChevronDown size={12} />}>
                              <ChevronUp size={12} />
                            </Show>
                          </Show>
                        </span>
                      </Show>
                    </span>
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            {/* Loading skeleton (first load only) */}
            <Show when={loading() && !initialized()}>
              <For each={Array(itemsPerPage())}>
                {() => (
                  <tr class="ksui-datatable-row">
                    <For each={columns()}>
                      {() => (
                        <td class="ksui-datatable-td">
                          <div class="ksui-datatable-skeleton" />
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </Show>

            {/* Empty state */}
            <Show when={initialized() && !loading() && paginatedData().length === 0}>
              <tr>
                <td colSpan={columns().length} class="ksui-datatable-empty">
                  {searchTerm()
                    ? props.noResultsMessage || "No results found."
                    : props.emptyMessage || "No data available."}
                </td>
              </tr>
            </Show>

            {/* Data rows */}
            <Show when={initialized() && paginatedData().length > 0}>
              <For each={paginatedData()}>
                {(row, rowIndex) => {
                  const expansion = () => props.expansionContent?.(row);
                  return (
                    <>
                      <tr
                        class="ksui-datatable-row"
                        classList={{ "ksui-datatable-row-clickable": !!props.onRowClick }}
                        onClick={() => props.onRowClick?.(row)}
                      >
                        <For each={columns()}>
                          {(col) => (
                            <td class={`ksui-datatable-td ${col.className || ""}`}>
                              {renderCell(col, row, rowIndex())}
                            </td>
                          )}
                        </For>
                      </tr>
                      <Show when={expansion()}>
                        <tr
                          // role="presentation" strips the implicit row role so
                          // callers' `getByRole('row')` queries don't double-match
                          // this wrapper AND its nested sub-rows.
                          role="presentation"
                          class="ksui-datatable-expansion-row"
                          data-testid="datatable-expansion-row"
                        >
                          <td class="ksui-datatable-expansion-td" colSpan={columns().length}>
                            {expansion()}
                          </td>
                        </tr>
                      </Show>
                    </>
                  );
                }}
              </For>
            </Show>
          </tbody>
        </table>
      </div>

      {/* Footer: Show more (loadMore mode) */}
      <Show when={loadMoreMode() && initialized()}>
        <div data-testid="datatable-show-more-footer" class="ksui-datatable-footer">
          <Show when={info()}>
            <span class="ksui-datatable-info">
              Showing {paginatedData().length} of {displayTotal()}
            </span>
          </Show>
          <Show when={apiConsumed() < totalRecords()}>
            <button
              data-testid="datatable-show-more-btn"
              disabled={loading()}
              onClick={handleShowMore}
              class="ksui-datatable-showmore"
            >
              {loading() ? "Loading..." : "Show more"}
            </button>
          </Show>
        </div>
      </Show>

      {/* Footer: pagination */}
      <Show when={!loadMoreMode() && paging() && totalPages() > 1}>
        <div class="ksui-datatable-footer">
          <Show when={info()}>
            <span class="ksui-datatable-info">
              Page {currentPage()} of {totalPages()} ({displayTotal()} results)
            </span>
          </Show>

          <div class="ksui-datatable-pager">
            <button
              disabled={currentPage() <= 1}
              onClick={() => handlePageChange(currentPage() - 1)}
              class="ksui-datatable-pager-arrow"
            >
              <ChevronLeft size={16} />
            </button>
            <For each={pageNumbers()}>
              {(p) => (
                <Show
                  when={p !== "..."}
                  fallback={<span class="ksui-datatable-pager-ellipsis">...</span>}
                >
                  <button
                    class={`ksui-datatable-pager-num ${currentPage() === p ? "ksui-datatable-pager-num-active" : ""}`}
                    onClick={() => handlePageChange(p as number)}
                  >
                    {p}
                  </button>
                </Show>
              )}
            </For>
            <button
              disabled={currentPage() >= totalPages()}
              onClick={() => handlePageChange(currentPage() + 1)}
              class="ksui-datatable-pager-arrow"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default DataTable;
