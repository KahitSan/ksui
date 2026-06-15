// CANONICAL SDK type defs for the host UI kit (window.__KSERP_UI__, externalized
// as "@kserp/host-ui"). This ships in @kahitsan/plugin-ui and is the single
// source of truth — every plugin (ours, and any third-party with no kernel
// source) gets it from the installed package via
// `/// <reference types="@kahitsan/plugin-ui/host-ui" />`; there are no more
// per-plugin copies to drift. The host owns the runtime: its remote loader
// (kserp src/lib/remote-loader.ts) populates the global from the host's kit
// barrel (kserp src/lib/host-ui.tsx) before loading any remote. Keep this in sync
// with that barrel — every member here must be exported there, and vice-versa.
declare module "@kserp/host-ui" {
  import type { JSX, Accessor } from "solid-js";

  // --- Shared table types (mirror src/components/ui/DataTable/DataTable.tsx) ---
  export interface DataTableRow {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }
  export interface DataTableColumn<T extends DataTableRow> {
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
  export interface FetchResult<T> {
    data: T[];
    total: number;
  }
  export interface FetchParams {
    page: number;
    limit: number;
    search: string;
    sortBy: string | null;
    sortDir: "asc" | "desc";
    dateFilter: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
  }

  export interface DataTableProps<T extends DataTableRow> {
    columns?: DataTableColumn<T>[];
    /**
     * Generic data fetcher. When provided, the table runs in server-side mode.
     * Optional: omit it and pass `data` for client-side mode.
     */
    fetchFn?: (params: FetchParams) => Promise<FetchResult<T>>;
    /** Static data (client-side mode). Ignored when `fetchFn` is set. */
    data?: T[];
    /**
     * Expose the table's refetch handle to the parent. The callback receives
     * `{ refetch, resetAndRefetch }`: `refetch()` re-fetches with the current
     * state; `resetAndRefetch()` resets pagination to page 1 (clearing loadMore
     * accumulators) before fetching.
     */
    onRefetch?: (api: { refetch: () => void; resetAndRefetch: () => void }) => void;
    // Remaining props are passed through; kept permissive so plugins can use the
    // full surface of the host component without re-declaring it here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }
  export function DataTable<T extends DataTableRow>(props: DataTableProps<T>): JSX.Element;

  // --- DatePicker ---
  export interface DateRangeValue {
    start: string | null;
    end: string | null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function DatePicker(props: any): JSX.Element;

  // --- Modal ---
  // The Modal is mounted/unmounted by the caller (wrap it in <Show when={open}>);
  // there is no `open` prop. onClose fires on Escape / backdrop / dismissal.
  export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "5xl" | "7xl";
  export type ModalTone = "default" | "danger";
  export interface ModalProps {
    onClose: () => void;
    dismissable?: boolean;
    variant?: "default" | "sheet";
    size?: ModalSize;
    tone?: ModalTone;
    ariaLabel?: string;
    children: JSX.Element;
  }
  export function Modal(props: ModalProps): JSX.Element;

  // --- SearchableSelect ---
  export interface SearchableOption {
    value: string;
    label: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function SearchableSelect(props: any): JSX.Element;

  // --- Other components (permissive: full prop surface lives in the host) ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Button: (props: any) => JSX.Element;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const PageShell: (props: any) => JSX.Element;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const PageTitle: (props: any) => JSX.Element;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const PageShareButton: (props: any) => JSX.Element;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Avatar: (props: any) => JSX.Element;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const PluginPageLoader: (props: any) => JSX.Element;

  // --- Confirm ---
  export function confirm(opts: {
    title?: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }): Promise<boolean>;

  // --- Host hooks (run on the host's Solid runtime + context providers) ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function useActiveWorkspace(): any;
  export function useCan(code: string): Accessor<boolean>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function usePermissions(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function PermissionGate(props: any): JSX.Element;

  // --- Helpers ---
  export function highlightMatch(text: string, query: string, markClass?: string): JSX.Element;
  export function HighlightedText(props: {
    text: string;
    query: string;
    markClass?: string;
  }): JSX.Element;
  export function matchesQuery(text: string | null | undefined, query: string): boolean;
  export function matchesAny(query: string, ...fields: (string | null | undefined)[]): boolean;
  export function useFocusTrap(el: HTMLElement | undefined): () => void;
  export function autoFocusOnMount(el: HTMLElement | undefined): void;
}
