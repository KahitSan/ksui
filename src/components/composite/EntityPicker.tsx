// EntityPicker — a generic searchable-combobox for picking one record from a
// sibling plugin's list (clients, payees, …). It owns the whole interaction:
// a trigger button, a portal popup with debounced search, keyboard/click-outside
// dismissal, viewport-aware positioning, an optional inline "create new" row,
// and graceful degradation when the backing plugin is unreachable.
//
// It is DOMAIN-FREE: it knows nothing about clients or payees. The caller wires
// the data via `search` / `onCreate` and the display via `idOf` / `labelOf` /
// `secondaryOf` / `icon` / `noun`. Thin presets (ClientPicker, PayeePicker) pass
// those in, so there is exactly one copy of the popup mechanics.
//
// `selectedName` is a free-text fallback shown in the trigger when nothing is
// picked (e.g. a likely default) — handy when the backing API persists the name
// as a plain string regardless, so the form still saves if the plugin is absent.

import { Portal } from "solid-js/web";
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { highlightMatch } from "@kserp/host-ui";
import UserPlus from "lucide-solid/icons/user-plus";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import Loader2 from "lucide-solid/icons/loader-2";

export interface EntityPickerProps<T> {
  /** Currently selected record, or null. */
  selected: T | null;
  /** Free-text fallback shown in the trigger when `selected` is null. */
  selectedName?: string | null;
  /** Fired with the chosen record (or null when cleared). */
  onChange: (next: T | null) => void;

  /** Search the backing list. Receives the trimmed query (may be empty for the
   *  initial list). Should resolve to the matching records, or reject so the
   *  popup shows the error/fallback. */
  search: (query: string) => Promise<T[]>;
  /** Optional create-new handler. When provided AND the query has no exact
   *  match, a "New <noun> …" row appears; resolving selects the created record. */
  onCreate?: (name: string) => Promise<T>;

  /** Stable identity for selection matching + result keys. */
  idOf: (item: T) => string | number;
  /** Primary display label. */
  labelOf: (item: T) => string;
  /** Optional muted secondary line under the label in results. */
  secondaryOf?: (item: T) => string | null;

  /** Leading icon component (lucide-solid), e.g. Store / UserRound. */
  icon: (p: { size?: number; class?: string }) => JSX.Element;
  /** Singular noun for UI copy: "payee", "client". */
  noun: string;

  placeholder?: string;
  disabled?: boolean;
  /** Open the popup immediately on mount. */
  defaultOpen?: boolean;
  /** Prefix for the component's data-testids (default "entity-picker"). */
  testIdPrefix?: string;
}

const POPUP_MAX_HEIGHT = 360;
const POPUP_MIN_WIDTH = 320;
const SEARCH_DEBOUNCE_MS = 200;

export default function EntityPicker<T>(props: EntityPickerProps<T>): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [results, setResults] = createSignal<T[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});

  const tid = (suffix: string) => `${props.testIdPrefix ?? "entity-picker"}-${suffix}`;

  let triggerRef: HTMLButtonElement | undefined;
  let popupRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let activeFetchToken = 0;

  if (props.defaultOpen) queueMicrotask(() => setOpen(true));

  createEffect(() => {
    const q = query();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => setDebouncedQuery(q), SEARCH_DEBOUNCE_MS);
    onCleanup(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
    });
  });

  createEffect(() => {
    if (!open()) return;
    const q = debouncedQuery().trim();
    const token = ++activeFetchToken;
    setLoading(true);
    setError(null);
    props
      .search(q)
      .then((rows) => {
        if (token !== activeFetchToken) return;
        setResults(rows ?? []);
      })
      .catch((e) => {
        if (token !== activeFetchToken) return;
        setError(e instanceof Error ? e.message : "Failed to load");
        setResults([]);
      })
      .finally(() => {
        if (token !== activeFetchToken) return;
        setLoading(false);
      });
  });

  const updatePosition = () => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const vpHeight = window.innerHeight;
    const vpWidth = window.innerWidth;
    const width = Math.max(POPUP_MIN_WIDTH, rect.width);
    const spaceBelow = vpHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp = spaceBelow < POPUP_MAX_HEIGHT && spaceAbove > spaceBelow;
    const top = flipUp ? Math.max(8, rect.top - POPUP_MAX_HEIGHT - 4) : rect.bottom + 4;
    const maxHeight = Math.max(
      200,
      Math.min(POPUP_MAX_HEIGHT, flipUp ? spaceAbove - 12 : spaceBelow - 12),
    );
    const left = Math.min(Math.max(8, rect.left), vpWidth - width - 8);
    setPopupStyle({
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      "max-height": `${maxHeight}px`,
    });
  };

  createEffect(() => {
    if (!open()) return;
    updatePosition();
    queueMicrotask(() => inputRef?.focus());

    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef?.contains(t)) return;
      if (popupRef?.contains(t)) return;
      close();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onReflow = () => updatePosition();

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc, true);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc, true);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    });
  });

  const close = () => {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
    setError(null);
  };

  const trimmedQuery = () => query().trim();

  const hasExactMatch = () => {
    const q = trimmedQuery().toLowerCase();
    if (!q) return true;
    return results().some((r) => props.labelOf(r).trim().toLowerCase() === q);
  };

  const showCreateOption = () =>
    !!props.onCreate && trimmedQuery().length > 0 && !hasExactMatch() && !loading();

  const select = (item: T) => {
    props.onChange(item);
    close();
  };

  const createAndSelect = async () => {
    const name = trimmedQuery();
    if (!name || creating() || !props.onCreate) return;
    setCreating(true);
    setError(null);
    try {
      const created = await props.onCreate(name);
      props.onChange(created);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to create ${props.noun}`);
    } finally {
      setCreating(false);
    }
  };

  const clear = (e: MouseEvent) => {
    e.stopPropagation();
    props.onChange(null);
  };

  const triggerLabel = () => {
    if (props.selected) return props.labelOf(props.selected);
    if (props.selectedName && props.selectedName.trim()) return props.selectedName.trim();
    return null;
  };

  const placeholder = () => props.placeholder ?? `Tap to pick a ${props.noun}`;
  const Icon = props.icon;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid={tid("trigger")}
        disabled={props.disabled}
        onClick={() => !props.disabled && setOpen((o) => !o)}
        class="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-800/30 border border-zinc-700/50 hover:border-amber-500/40 hover:bg-amber-500/5 transition-colors text-sm text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={open()}
      >
        <Icon size={16} class="shrink-0 text-zinc-400" />
        <Show when={triggerLabel()} fallback={<span class="text-zinc-500 italic">{placeholder()}</span>}>
          <span class="flex-1 min-w-0">
            <span class="block truncate text-zinc-100 font-medium">{triggerLabel()}</span>
          </span>
          <button
            type="button"
            data-testid={tid("clear")}
            onClick={clear}
            class="shrink-0 p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            title="Clear"
            aria-label={`Clear ${props.noun}`}
          >
            <X size={14} />
          </button>
        </Show>
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={popupRef}
            data-testid={tid("popup")}
            class="z-[100] rounded-md border border-zinc-700 bg-zinc-900/95 backdrop-blur shadow-xl overflow-hidden flex flex-col"
            style={popupStyle()}
          >
            <div class="px-2 py-2 border-b border-zinc-800 flex items-center gap-2">
              <Search size={14} class="text-zinc-500 shrink-0 ml-1" />
              <input
                ref={inputRef}
                type="text"
                data-testid={tid("input")}
                role="combobox"
                aria-expanded={open()}
                aria-controls={`${tid("listbox")}`}
                aria-autocomplete="list"
                aria-label={`Search ${props.noun}s`}
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                placeholder={props.onCreate ? `Search or add a new ${props.noun}…` : `Search ${props.noun}s…`}
                class="w-full px-1 py-1 text-sm bg-transparent text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
              />
              <Show when={loading()}>
                <Loader2 size={14} class="animate-spin text-zinc-500 mr-1 shrink-0" />
              </Show>
            </div>
            <div class="flex-1 overflow-y-auto">
              <Show when={error()}>
                <div role="status" class="px-3 py-2 text-xs text-red-400">
                  {error()}
                </div>
              </Show>
              <Show when={!loading() && results().length === 0 && !showCreateOption() && !error()}>
                <div role="status" class="px-3 py-4 text-xs text-zinc-500 text-center">
                  {trimmedQuery() ? "No matches" : "Start typing or pick from your list…"}
                </div>
              </Show>
              <Show when={results().length > 0}>
                <ul
                  id={tid("listbox")}
                  data-testid={tid("listbox")}
                  role="listbox"
                  aria-label={`${props.noun} search results`}
                  class="m-0 p-0 list-none"
                >
                  <For each={results()}>
                    {(item) => {
                      const secondary = props.secondaryOf?.(item) ?? null;
                      const isSel = () =>
                        props.selected != null && props.idOf(props.selected) === props.idOf(item);
                      return (
                        <li role="option" aria-selected={isSel()}>
                          <button
                            type="button"
                            data-testid={`${tid("result")}-${props.idOf(item)}`}
                            onClick={() => select(item)}
                            class="w-full text-left px-3 py-2 hover:bg-amber-500/10 transition-colors flex items-start gap-2 cursor-pointer"
                          >
                            <Icon size={14} class="text-zinc-500 shrink-0 mt-0.5" />
                            <span class="flex-1 min-w-0">
                              <span class="block text-sm text-zinc-100 truncate">
                                {highlightMatch(props.labelOf(item), debouncedQuery().trim())}
                              </span>
                              <Show when={secondary}>
                                <span class="block text-[11px] text-zinc-500 truncate">
                                  {highlightMatch(secondary!, debouncedQuery().trim())}
                                </span>
                              </Show>
                            </span>
                            <Show when={isSel()}>
                              <span class="text-amber-400 text-xs shrink-0 mt-0.5">✓</span>
                            </Show>
                          </button>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Show>
              <Show when={showCreateOption()}>
                <div class="border-t border-zinc-800">
                  <button
                    type="button"
                    data-testid={tid("create")}
                    onClick={createAndSelect}
                    disabled={creating()}
                    class="w-full text-left px-3 py-2.5 hover:bg-emerald-500/10 transition-colors flex items-center gap-2 cursor-pointer disabled:cursor-wait disabled:opacity-60"
                  >
                    <Show
                      when={!creating()}
                      fallback={<Loader2 size={14} class="animate-spin text-emerald-400 shrink-0" />}
                    >
                      <UserPlus size={14} class="text-emerald-400 shrink-0" />
                    </Show>
                    <span class="text-sm text-emerald-300">
                      New {props.noun} "<span class="font-medium">{trimmedQuery()}</span>"
                    </span>
                  </button>
                </div>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
