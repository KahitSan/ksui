// Mock of "@kserp/host-ui" for the docs site.
//
// Re implements the exact export surface of the canonical SDK decl
// (ksui/host-ui.d.ts). Presentational primitives (Button, Modal, the focus /
// dom helpers) are now the REAL kserp sources, copied verbatim into
// ../host-kit so every demo looks exactly like it does in the live app: the
// Button's scanline shimmer, clip-path corners, ripple, glow, and intent
// colors all render here. The genuinely entangled exports (auth / permission
// hooks that need a Solid context + a backend) stay as sample-data mocks so
// the docs can render without a server. Wired in via resolve.alias in
// vite.config.ts, keyed on the bare specifier, so a component's
// `import { Button } from "@kserp/host-ui"` resolves here unchanged.

import { createSignal, createMemo, For, Show, onMount, type Accessor, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

// === Faithful real components (copied from kserp, see ../host-kit) ===
export { default as Button } from "../host-kit/Button";
export type { ButtonProps } from "../host-kit/Button";
export { Modal } from "../host-kit/Modal";
export type { ModalProps, ModalSize, ModalTone } from "../host-kit/Modal";
export { useFocusTrap, autoFocusOnMount, lockPullToRefresh, unlockPullToRefresh } from "../host-kit/dom";

// === Shared table types ===
export interface DataTableRow {
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
  fetchFn?: (params: FetchParams) => Promise<FetchResult<T>>;
  data?: T[];
  onRefetch?: (api: { refetch: () => void; resetAndRefetch: () => void }) => void;
  [key: string]: any;
}

// === DataTable (lightweight stand-in; no demo page exercises it yet) ===
export function DataTable<T extends DataTableRow>(props: DataTableProps<T>): JSX.Element {
  const [rows, setRows] = createSignal<T[]>(props.data ?? []);
  onMount(() => {
    if (props.fetchFn) {
      props
        .fetchFn({
          page: 1,
          limit: 25,
          search: "",
          sortBy: null,
          sortDir: "asc",
          dateFilter: null,
        })
        .then((r) => setRows(r.data))
        .catch(() => setRows([] as T[]));
    }
  });
  const cols = () => props.columns ?? [];
  return (
    <table class="w-full border-collapse text-sm">
      <thead>
        <tr class="border-b border-zinc-800/50 text-left">
          <For each={cols()}>{(c) => <th class="px-3 py-2 font-semibold">{c.title ?? c.data}</th>}</For>
        </tr>
      </thead>
      <tbody>
        <For each={rows()}>
          {(row, i) => (
            <tr class="border-b border-zinc-800/40">
              <For each={cols()}>
                {(c, j) => (
                  <td class="px-3 py-2">
                    {c.render
                      ? (c.render(c.data ? (row[c.data] as any) : null, "display", row, {
                          row: i(),
                          col: j(),
                          search: "",
                        }) as any)
                      : c.data
                        ? String(row[c.data] ?? "")
                        : ""}
                  </td>
                )}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

// === DatePicker (lightweight stand-in; no demo page exercises it yet) ===
export interface DateRangeValue {
  start: string | null;
  end: string | null;
}
export function DatePicker(props: any): JSX.Element {
  return (
    <input
      type="date"
      class="h-10 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
      value={props.value ?? ""}
      onInput={(e) => props.onChange?.(e.currentTarget.value)}
    />
  );
}

// === SearchableSelect (lightweight stand-in; no demo page exercises it yet) ===
export interface SearchableOption {
  value: string;
  label: string;
  [key: string]: any;
}
export function SearchableSelect(props: any): JSX.Element {
  const options = (): SearchableOption[] => props.options ?? [];
  return (
    <select
      class="h-10 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100"
      value={props.value ?? ""}
      onChange={(e) => props.onChange?.(e.currentTarget.value)}
    >
      <Show when={props.placeholder}>
        <option value="">{props.placeholder}</option>
      </Show>
      <For each={options()}>{(o) => <option value={o.value}>{o.label}</option>}</For>
    </select>
  );
}

// === Page wrappers (lightweight stand-ins) ===
export const PageShell = (props: any): JSX.Element => (
  <div class={`mx-auto max-w-5xl ${props.class ?? ""}`}>{props.children}</div>
);
export const PageTitle = (props: any): JSX.Element => (
  <h1 class="text-2xl font-bold text-zinc-100">{props.children ?? props.title}</h1>
);
export const PageShareButton = (props: any): JSX.Element => (
  <button
    type="button"
    onClick={props.onClick}
    class="rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-zinc-400 hover:text-amber-300 hover:bg-amber-500/5"
  >
    Share
  </button>
);

// === Avatar (square logo or initials; account avatar intent) ===
export const Avatar = (props: any): JSX.Element => {
  const initials = () => {
    const name = String(props.name ?? "?").trim();
    const parts = name.split(/\s+/).slice(0, 2);
    return parts.map((p: string) => p[0]?.toUpperCase() ?? "").join("") || "?";
  };
  return (
    <Show
      when={props.src}
      fallback={
        <div class="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-800 text-sm font-semibold text-zinc-200">
          {initials()}
        </div>
      }
    >
      <img src={props.src} alt={props.name ?? ""} class="h-10 w-10 rounded-md object-cover" />
    </Show>
  );
};

export const PluginPageLoader = (_props: any): JSX.Element => (
  <div class="flex items-center justify-center p-8 text-zinc-400">
    <span class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-current border-r-transparent" />
  </div>
);

// === confirm ===
export function confirm(opts: {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  const text = [opts.title, opts.message].filter(Boolean).join("\n\n");
  return Promise.resolve(window.confirm(text || "Are you sure?"));
}

// === Host hooks (sample-data mocks; no backend in the docs) ===
const FAKE_WORKSPACE = { id: 1, name: "Demo Workspace", organization_id: 1 };
export function useActiveWorkspace(): any {
  const [ws] = createSignal(FAKE_WORKSPACE);
  return ws;
}

// Overridable global so docs controls can flip permission state.
let canOverride: boolean | null = true;
export function setDocsCanOverride(value: boolean | null) {
  canOverride = value;
}
export function useCan(_code: string): Accessor<boolean> {
  return createMemo(() => (canOverride === null ? true : canOverride));
}
export function usePermissions(): any {
  const allow = () => (canOverride === null ? true : canOverride);
  return {
    can: (_code: string) => allow(),
    has: (_code: string) => allow(),
    hasAny: (..._codes: string[]) => allow(),
    hasAll: (..._codes: string[]) => allow(),
    hasEffective: (_code: string) => allow(),
    isLoading: () => false,
    loading: () => false,
  };
}
export function PermissionGate(props: any): JSX.Element {
  return <>{props.children}</>;
}

// === Helpers (pure ports of the real string match utilities) ===
export function matchesQuery(text: string | null | undefined, query: string): boolean {
  if (!query) return true;
  if (!text) return false;
  return text.toLowerCase().includes(query.toLowerCase());
}
export function matchesAny(query: string, ...fields: (string | null | undefined)[]): boolean {
  if (!query) return true;
  return fields.some((f) => matchesQuery(f, query));
}
export function highlightMatch(text: string, query: string, markClass?: string): JSX.Element {
  if (!query || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const out: JSX.Element[] = [];
  let i = 0;
  let idx = lower.indexOf(q, i);
  let key = 0;
  while (idx !== -1) {
    if (idx > i) out.push(<>{text.slice(i, idx)}</>);
    out.push(
      <mark class={markClass ?? "bg-amber-500/30 text-amber-100 rounded-sm"} data-key={key++}>
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
    idx = lower.indexOf(q, i);
  }
  if (i < text.length) out.push(<>{text.slice(i)}</>);
  return <>{out}</>;
}
export function HighlightedText(props: { text: string; query: string; markClass?: string }): JSX.Element {
  return <>{highlightMatch(props.text, props.query, props.markClass)}</>;
}
