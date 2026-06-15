// Source: KahitSan/kserp src/components/ClientPicker.tsx (vendored into the plugin remote).
//
// Cross-plugin picker: fetches the SIBLING clients plugin's public API at
// /api/clients. Degrades gracefully: when the clients plugin isn't deployed
// the fetch 404s/fails, the popup shows an inline "couldn't load" notice, and
// the rest of the transaction modal still works (the sale just has no
// billed-to client). highlightMatch comes from the host UI kit.

import { Portal } from "solid-js/web";
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import UserRound from "lucide-solid/icons/user-round";
import UserPlus from "lucide-solid/icons/user-plus";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import Loader2 from "lucide-solid/icons/loader-2";
import { highlightMatch } from "@kserp/host-ui";

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

const POPUP_MAX_HEIGHT = 360;
const POPUP_MIN_WIDTH = 320;
const SEARCH_DEBOUNCE_MS = 200;

export default function ClientPicker(props: ClientPickerProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  onMount(() => {
    if (props.defaultOpen) queueMicrotask(() => setOpen(true));
  });
  const [query, setQuery] = createSignal("");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [results, setResults] = createSignal<ClientOption[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});

  let triggerRef: HTMLButtonElement | undefined;
  let popupRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let activeFetchToken = 0;

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
    const params = new URLSearchParams({ status: "active", limit: "10" });
    if (q) params.set("search", q);
    fetch(`/api/clients?${params.toString()}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok)
          throw new Error(
            r.status === 403
              ? "Permission denied"
              : r.status === 404
                ? "Clients module isn't available"
                : "Failed to load",
          );
        return r.json();
      })
      .then((json) => {
        if (token !== activeFetchToken) return;
        setResults((json.data || []) as ClientOption[]);
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
    return results().some((r) => r.name_raw.trim().toLowerCase() === q);
  };

  const showCreateOption = () => trimmedQuery().length > 0 && !hasExactMatch() && !loading();

  const select = (c: ClientOption) => {
    props.onChange(c);
    close();
  };

  const createAndSelect = async () => {
    const name = trimmedQuery();
    if (!name || creating()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name_raw: name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to create client" }));
        throw new Error(body.error || "Failed to create client");
      }
      const created = (await res.json()) as ClientOption;
      props.onChange(created);
      props.onCreate?.(created);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create client");
    } finally {
      setCreating(false);
    }
  };

  const clear = (e: MouseEvent) => {
    e.stopPropagation();
    props.onChange(null);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="client-picker-trigger"
        disabled={props.disabled}
        onClick={() => !props.disabled && setOpen((o) => !o)}
        class={`w-full mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-colors text-sm text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
          props.selected
            ? "bg-zinc-800/30 border-zinc-700/50 hover:border-amber-500/40 hover:bg-amber-500/5"
            : "bg-red-500/5 border-red-500/40 hover:bg-red-500/10 hover:border-red-500/60"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open()}
      >
        <UserRound size={16} class={`shrink-0 ${props.selected ? "text-zinc-400" : "text-red-300"}`} />
        <Show
          when={props.selected}
          fallback={<span class="text-red-300/90 italic">Walk-in (tap to pick a client)</span>}
        >
          <span class="flex-1 min-w-0">
            <span class="block truncate text-zinc-100 font-medium">{props.selected!.name_raw}</span>
            <Show when={props.selected!.email || props.selected!.phone}>
              <span class="block truncate text-[11px] text-zinc-500">
                {props.selected!.email || props.selected!.phone}
              </span>
            </Show>
          </span>
          <button
            type="button"
            data-testid="client-picker-clear"
            onClick={clear}
            class="shrink-0 p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            title="Reset to walk-in"
            aria-label="Reset to walk-in"
          >
            <X size={14} />
          </button>
        </Show>
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={popupRef}
            data-testid="client-picker-popup"
            class="z-[100] rounded-md border border-zinc-700 bg-zinc-900/95 backdrop-blur shadow-xl overflow-hidden flex flex-col"
            style={popupStyle()}
          >
            <div class="px-2 py-2 border-b border-zinc-800 flex items-center gap-2">
              <Search size={14} class="text-zinc-500 shrink-0 ml-1" />
              <input
                ref={inputRef}
                type="text"
                data-testid="client-picker-input"
                role="combobox"
                aria-expanded={open()}
                aria-controls="client-picker-listbox"
                aria-autocomplete="list"
                aria-label="Search clients"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                placeholder="Search clients by name, email, phone…"
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
                  {trimmedQuery() ? "No matches" : "Type to search clients…"}
                </div>
              </Show>
              <Show when={results().length > 0}>
                <ul
                  id="client-picker-listbox"
                  data-testid="client-picker-listbox"
                  role="listbox"
                  aria-label="Client search results"
                  class="m-0 p-0 list-none"
                >
                  <For each={results()}>
                    {(c) => (
                      <li role="option" aria-selected={props.selected?.id === c.id}>
                        <button
                          type="button"
                          data-testid={`client-picker-result-${c.id}`}
                          onClick={() => select(c)}
                          class="w-full text-left px-3 py-2 hover:bg-amber-500/10 transition-colors flex items-start gap-2 cursor-pointer"
                        >
                          <UserRound size={14} class="text-zinc-500 shrink-0 mt-0.5" />
                          <span class="flex-1 min-w-0">
                            <span class="block text-sm text-zinc-100 truncate">
                              {highlightMatch(c.name_raw, debouncedQuery().trim())}
                            </span>
                            <Show when={c.email || c.phone}>
                              <span class="block text-[11px] text-zinc-500 truncate">
                                {highlightMatch(
                                  [c.email, c.phone].filter(Boolean).join(" · "),
                                  debouncedQuery().trim(),
                                )}
                              </span>
                            </Show>
                          </span>
                          <Show when={props.selected?.id === c.id}>
                            <span class="text-amber-400 text-xs shrink-0 mt-0.5">✓</span>
                          </Show>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={showCreateOption()}>
                <div class="border-t border-zinc-800">
                  <button
                    type="button"
                    data-testid="client-picker-create"
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
                      Create "<span class="font-medium">{trimmedQuery()}</span>"
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
