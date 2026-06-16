// PayeePicker — a searchable combobox for the "Paid to" / "Received from" /
// "Payable to" field. The canonical copy lives here in @kahitsan/ksui (a
// composite ERP picker, sibling to ClientPicker / VoucherPicker); plugins
// import it instead of vendoring their own.
//
// Fetches the SIBLING payees plugin's public API at /api/payees and degrades
// gracefully — when the payees plugin isn't deployed the popup shows a
// "couldn't load" notice but the free-text fallback (selectedName) keeps the
// trigger usable, and the consuming API can persist payee as a plain string
// regardless, so the form still saves.

import { Portal } from "solid-js/web";
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import Store from "lucide-solid/icons/store";
import UserPlus from "lucide-solid/icons/user-plus";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import Loader2 from "lucide-solid/icons/loader-2";

export type PayeeKind = "vendor" | "customer" | "both";

export interface PayeeOption {
  id: number;
  name: string;
  kind: PayeeKind;
  default_subcategory?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

interface PayeePickerProps {
  selected: PayeeOption | null;
  selectedName?: string | null;
  kind?: PayeeKind;
  createAsKind?: PayeeKind;
  placeholder?: string;
  onChange: (next: PayeeOption | null) => void;
  disabled?: boolean;
  testIdPrefix?: string;
}

const POPUP_MAX_HEIGHT = 360;
const POPUP_MIN_WIDTH = 320;
const SEARCH_DEBOUNCE_MS = 200;

export default function PayeePicker(props: PayeePickerProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [results, setResults] = createSignal<PayeeOption[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});

  const tid = (suffix: string) => `${props.testIdPrefix ?? "payee-picker"}-${suffix}`;

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
    const params = new URLSearchParams({ status: "active", limit: "20" });
    if (q) params.set("search", q);
    if (props.kind) params.set("kind", props.kind);
    fetch(`/api/payees?${params.toString()}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok)
          throw new Error(
            r.status === 403
              ? "Permission denied"
              : r.status === 404
                ? "Payees module isn't available — type a name instead"
                : "Failed to load",
          );
        return r.json();
      })
      .then((json) => {
        if (token !== activeFetchToken) return;
        setResults((json.data || []) as PayeeOption[]);
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
    return results().some((r) => r.name.trim().toLowerCase() === q);
  };

  const showCreateOption = () => trimmedQuery().length > 0 && !hasExactMatch() && !loading();

  const select = (p: PayeeOption) => {
    props.onChange(p);
    close();
  };

  const createAndSelect = async () => {
    const name = trimmedQuery();
    if (!name || creating()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/payees", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind: props.createAsKind ?? props.kind ?? "vendor" }),
      });
      if (!res.ok && res.status !== 200) {
        const body = await res.json().catch(() => ({ error: "Failed to create payee" }));
        throw new Error(body.error || "Failed to create payee");
      }
      const created = (await res.json()) as PayeeOption;
      props.onChange(created);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create payee");
    } finally {
      setCreating(false);
    }
  };

  const clear = (e: MouseEvent) => {
    e.stopPropagation();
    props.onChange(null);
  };

  const triggerLabel = () => {
    if (props.selected) return props.selected.name;
    if (props.selectedName && props.selectedName.trim()) return props.selectedName.trim();
    return null;
  };

  const placeholder = () => props.placeholder ?? "Tap to pick a payee";

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
        <Store size={16} class="shrink-0 text-zinc-400" />
        <Show when={triggerLabel()} fallback={<span class="text-zinc-500 italic">{placeholder()}</span>}>
          <span class="flex-1 min-w-0">
            <span class="block truncate text-zinc-100 font-medium">{triggerLabel()}</span>
            <Show when={props.selected && !props.selected.id}>
              <span class="block text-[11px] text-zinc-500">unlinked (legacy)</span>
            </Show>
          </span>
          <button
            type="button"
            data-testid={tid("clear")}
            onClick={clear}
            class="shrink-0 p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            title="Clear"
            aria-label="Clear payee"
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
                aria-label="Search payees"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                placeholder="Search or add a new payee…"
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
                  aria-label="Payee search results"
                  class="m-0 p-0 list-none"
                >
                  <For each={results()}>
                    {(p) => (
                      <li role="option" aria-selected={props.selected?.id === p.id}>
                        <button
                          type="button"
                          data-testid={`${tid("result")}-${p.id}`}
                          onClick={() => select(p)}
                          class="w-full text-left px-3 py-2 hover:bg-amber-500/10 transition-colors flex items-start gap-2 cursor-pointer"
                        >
                          <Store size={14} class="text-zinc-500 shrink-0 mt-0.5" />
                          <span class="flex-1 min-w-0">
                            <span class="block text-sm text-zinc-100 truncate">{p.name}</span>
                            <Show when={p.default_subcategory || p.kind !== "vendor"}>
                              <span class="block text-[11px] text-zinc-500 truncate">
                                {[p.kind === "vendor" ? null : p.kind, p.default_subcategory]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </Show>
                          </span>
                          <Show when={props.selected?.id === p.id}>
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
                      New payee "<span class="font-medium">{trimmedQuery()}</span>"
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
