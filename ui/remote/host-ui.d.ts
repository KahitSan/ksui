// CANONICAL SDK type defs for the host UI kit (window.__KSERP_UI__, externalized
// as "@kserp/host-ui"). This is the source of truth — copy it verbatim into each
// plugin at ui/remote/host-ui.d.ts. The host owns the runtime: its remote loader
// (src/lib/remote-loader.ts) populates the global from the host's kit barrel
// (src/lib/host-ui.tsx) before loading any remote. Keep this in sync with that
// barrel — every member here must be exported there, and vice-versa.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface DataTableProps<T extends DataTableRow> {
    columns: DataTableColumn<T>[];
    fetchFn: (params: FetchParams) => Promise<FetchResult<T>>;
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
  export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "5xl" | "7xl";
  export type ModalTone = "default" | "danger";
  export interface ModalProps {
    open: boolean;
    onClose: () => void;
    title?: string;
    size?: ModalSize;
    tone?: ModalTone;
    children?: JSX.Element;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
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
  export function useActiveOrg(): any;
  export function useCan(code: string): Accessor<boolean>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function usePermissions(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function PermissionGate(props: any): JSX.Element;

  // --- Helpers ---
  export function highlightMatch(text: string, query: string, markClass?: string): JSX.Element;
  export function HighlightedText(props: { text: string; query: string; markClass?: string }): JSX.Element;
  export function matchesQuery(text: string | null | undefined, query: string): boolean;
  export function matchesAny(query: string, ...fields: (string | null | undefined)[]): boolean;
  export function useFocusTrap(el: HTMLElement | undefined): () => void;
  export function autoFocusOnMount(el: HTMLElement | undefined): void;
}
