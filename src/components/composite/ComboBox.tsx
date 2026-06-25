// ComboBox — a generic searchable-combobox for picking record(s) from a
// sibling plugin's list (clients, payees, …). It owns the whole interaction:
// a debounced portal popup with search/results, an optional inline "create new"
// row, viewport-aware positioning, keyboard/click-outside dismissal, and
// graceful degradation when the backing plugin is unreachable.
//
// It is DOMAIN-FREE: it knows nothing about clients or payees. The caller wires
// the data via `search` / `onCreate` and the display via `idOf` / `labelOf` /
// `secondaryOf` / `icon` / `noun` at each call site (e.g. a payee or client
// picker), so there is exactly one copy of the popup mechanics.
//
// Two modes share that one engine:
//   • single (default) — a button trigger; picking one record fills it. The
//     `selectedName` free-text fallback is shown when nothing is picked (handy
//     when the backing API persists the name as a plain string regardless, so
//     the form still saves if the plugin is absent).
//   • multiple — an inline chips+input row; picking adds a chip, so the value
//     is an ordered T[]. Optional `primaryStar` marks value[0] as the primary
//     (star) with click-to-promote, `invalid` paints the required/empty tone,
//     and `lockedIds` anchors specific chips.

import { Portal } from "solid-js/web";
import { createEffect, createSignal, For, onMount, Show, type JSX } from "solid-js";
import { highlightMatch } from "../../utils/highlight";
import UserPlus from "lucide-solid/icons/user-plus";
import Search from "lucide-solid/icons/search";
import Star from "lucide-solid/icons/star";
import X from "lucide-solid/icons/x";
import Loader2 from "lucide-solid/icons/loader-2";
import { createPickerPopup } from "./picker-engine";

interface ComboBoxCommonProps<T> {
  /** Search the backing list. Receives the trimmed query (may be empty for the
   *  initial list). Should resolve to the matching records, or reject so the
   *  popup shows the error/fallback. */
  search: (query: string) => Promise<T[]>;
  /** Optional create-new handler. When provided AND the query has no exact
   *  match, a "New <noun> …" row appears; resolving picks/adds the created
   *  record. */
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
  /** Prefix for the component's data-testids (default "combo-box"). */
  testIdPrefix?: string;
}

export interface ComboBoxSingleProps<T> extends ComboBoxCommonProps<T> {
  /** Single-select mode (the default). */
  multiple?: false;
  /** Currently selected record, or null. */
  selected: T | null;
  /** Free-text fallback shown in the trigger when `selected` is null. */
  selectedName?: string | null;
  /** Fired with the chosen record (or null when cleared). */
  onChange: (next: T | null) => void;
  /** Open the popup immediately on mount. */
  defaultOpen?: boolean;
}

export interface ComboBoxMultiProps<T> extends ComboBoxCommonProps<T> {
  /** Multi-select mode: an inline chips+input row, value is an ordered list. */
  multiple: true;
  /** The selected records, in order. With `primaryStar`, value[0] is primary. */
  value: T[];
  /** Fired with the new ordered list on add / remove / promote. */
  onChange: (next: T[]) => void;
  /** Treat value[0] as the primary: star it and let other chips promote to it. */
  primaryStar?: boolean;
  /** Paint the required/empty (red) tone — e.g. a mandatory field left empty. */
  invalid?: boolean;
  /** Chip ids that stay anchored: their remove/promote controls are disabled,
   *  but the input stays enabled so more records can still be added. */
  lockedIds?: (string | number)[];
  /** Focus the inline input on mount (marks the wrapper with `data-autofocus`
   *  for a host modal's focus helper). */
  autoFocusOnMount?: boolean;
  /** Close the results popup after each add/create instead of keeping it open
   *  for rapid multi-add. The input keeps focus and the popup reopens on the
   *  next keystroke. Use when the popup overlays a click target below it (e.g.
   *  the POS package grid) so a lingering popup would eat the next click. */
  closeOnSelect?: boolean;
}

export type ComboBoxProps<T> = ComboBoxSingleProps<T> | ComboBoxMultiProps<T>;

export default function ComboBox<T>(props: ComboBoxProps<T>): JSX.Element {
  // Mode is read once at setup — call sites pick single/multi statically (same
  // convention as the Modal variant). Narrowing makes each branch see
  // its concrete prop shape.
  if (props.multiple) return MultiComboBox(props);
  return SingleComboBox(props);
}

// ---------------------------------------------------------------------------
// Single-select — button trigger + popup with its own search input.
// ---------------------------------------------------------------------------
function SingleComboBox<T>(props: ComboBoxSingleProps<T>): JSX.Element {
  let triggerRef: HTMLButtonElement | undefined;
  let popupRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  const eng = createPickerPopup<T>({
    search: (q) => props.search(q),
    getAnchor: () => triggerRef,
    getPopup: () => popupRef,
  });

  const tid = (suffix: string) => `${props.testIdPrefix ?? "combo-box"}-${suffix}`;

  if (props.defaultOpen) queueMicrotask(() => eng.setOpen(true));

  // Focus the popup's search input whenever it opens.
  createEffect(() => {
    if (eng.open()) queueMicrotask(() => inputRef?.focus());
  });

  const hasExactMatch = () => {
    const q = eng.trimmedQuery().toLowerCase();
    if (!q) return true;
    return eng.results().some((r) => props.labelOf(r).trim().toLowerCase() === q);
  };
  const showCreateOption = () =>
    !!props.onCreate && eng.trimmedQuery().length > 0 && !hasExactMatch() && !eng.loading();

  const select = (item: T) => {
    props.onChange(item);
    eng.close();
  };

  const createAndSelect = async () => {
    const name = eng.trimmedQuery();
    if (!name || eng.creating() || !props.onCreate) return;
    eng.setCreating(true);
    eng.setError(null);
    try {
      const created = await props.onCreate(name);
      props.onChange(created);
      eng.close();
    } catch (e) {
      eng.setError(e instanceof Error ? e.message : `Failed to create ${props.noun}`);
    } finally {
      eng.setCreating(false);
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
        onClick={() => !props.disabled && eng.setOpen((o) => !o)}
        class="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-800/30 border border-zinc-700/50 hover:border-amber-500/40 hover:bg-amber-500/5 transition-colors text-sm text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={eng.open()}
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

      <Show when={eng.open()}>
        <Portal>
          <div
            ref={popupRef}
            data-testid={tid("popup")}
            class="z-[10000] rounded-md border border-zinc-700 bg-zinc-900/95 backdrop-blur shadow-xl overflow-hidden flex flex-col"
            style={eng.popupStyle()}
          >
            <div class="px-2 py-2 border-b border-zinc-800 flex items-center gap-2">
              <Search size={14} class="text-zinc-500 shrink-0 ml-1" />
              <input
                ref={inputRef}
                type="text"
                data-testid={tid("input")}
                role="combobox"
                aria-expanded={eng.open()}
                aria-controls={`${tid("listbox")}`}
                aria-autocomplete="list"
                aria-label={`Search ${props.noun}s`}
                value={eng.query()}
                onInput={(e) => eng.setQuery(e.currentTarget.value)}
                placeholder={props.onCreate ? `Search or add a new ${props.noun}…` : `Search ${props.noun}s…`}
                class="w-full px-1 py-1 text-sm bg-transparent text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
              />
              <Show when={eng.loading()}>
                <Loader2 size={14} class="animate-spin text-zinc-500 mr-1 shrink-0" />
              </Show>
            </div>
            <div class="flex-1 overflow-y-auto">
              <Show when={eng.error()}>
                <div role="status" class="px-3 py-2 text-xs text-red-400">
                  {eng.error()}
                </div>
              </Show>
              <Show when={!eng.loading() && eng.results().length === 0 && !showCreateOption() && !eng.error()}>
                <div role="status" class="px-3 py-4 text-xs text-zinc-500 text-center">
                  {eng.trimmedQuery() ? "No matches" : "Start typing or pick from your list…"}
                </div>
              </Show>
              <Show when={eng.results().length > 0}>
                <ul
                  id={tid("listbox")}
                  data-testid={tid("listbox")}
                  role="listbox"
                  aria-label={`${props.noun} search results`}
                  class="m-0 p-0 list-none"
                >
                  <For each={eng.results()}>
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
                                {highlightMatch(props.labelOf(item), eng.debouncedQuery().trim())}
                              </span>
                              <Show when={secondary}>
                                <span class="block text-[11px] text-zinc-500 truncate">
                                  {highlightMatch(secondary!, eng.debouncedQuery().trim())}
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
                    disabled={eng.creating()}
                    class="w-full text-left px-3 py-2.5 hover:bg-emerald-500/10 transition-colors flex items-center gap-2 cursor-pointer disabled:cursor-wait disabled:opacity-60"
                  >
                    <Show
                      when={!eng.creating()}
                      fallback={<Loader2 size={14} class="animate-spin text-emerald-400 shrink-0" />}
                    >
                      <UserPlus size={14} class="text-emerald-400 shrink-0" />
                    </Show>
                    <span class="text-sm text-emerald-300">
                      New {props.noun} "<span class="font-medium">{eng.trimmedQuery()}</span>"
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

// ---------------------------------------------------------------------------
// Multi-select — inline chips + input row; popup is results only.
// ---------------------------------------------------------------------------
type DisplayOption<T> = { create: true; name: string } | { create: false; item: T };

function MultiComboBox<T>(props: ComboBoxMultiProps<T>): JSX.Element {
  let wrapperRef: HTMLDivElement | undefined;
  let popupRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  const [focusedIdx, setFocusedIdx] = createSignal(0);

  const eng = createPickerPopup<T>({
    search: (q) => props.search(q),
    getAnchor: () => wrapperRef,
    getPopup: () => popupRef,
    clearOnDismiss: false,
    onResults: () => setFocusedIdx(0),
  });

  const tid = (suffix: string) => `${props.testIdPrefix ?? "combo-box"}-${suffix}`;

  const idOf = (item: T) => props.idOf(item);
  const isLocked = (item: T) => (props.lockedIds ?? []).includes(idOf(item));
  const selectedIds = () => new Set(props.value.map(idOf));
  const filteredResults = () => eng.results().filter((r) => !selectedIds().has(idOf(r)));

  const hasExactMatch = () => {
    const q = eng.trimmedQuery().toLowerCase();
    if (!q) return true;
    return [...eng.results(), ...props.value].some((r) => props.labelOf(r).trim().toLowerCase() === q);
  };
  const showCreateOption = () =>
    !!props.onCreate && eng.trimmedQuery().length > 0 && !hasExactMatch() && !eng.loading();

  const displayOptions = (): DisplayOption<T>[] => {
    const list: DisplayOption<T>[] = [];
    if (showCreateOption()) list.push({ create: true, name: eng.trimmedQuery() });
    for (const r of filteredResults()) list.push({ create: false, item: r });
    return list;
  };

  const resetInput = () => {
    eng.setQuery("");
    if (inputRef) inputRef.value = "";
    queueMicrotask(() => inputRef?.focus());
  };

  const addToPool = (item: T) => {
    if (props.value.some((x) => idOf(x) === idOf(item))) return;
    // Close the popup BEFORE mutating the value when closeOnSelect: otherwise the
    // about-to-be-hidden results list re-renders against the new value first,
    // which the user sees as a flicker. resetInput re-focuses the input, so the
    // next keystroke reopens the popup (the input's onInput re-opens it).
    if (props.closeOnSelect) eng.setOpen(false);
    props.onChange([...props.value, item]);
    resetInput();
  };

  const removeFromPool = (item: T) => {
    if (isLocked(item)) return;
    props.onChange(props.value.filter((c) => idOf(c) !== idOf(item)));
  };

  const promoteToPrimary = (item: T) => {
    if (!props.primaryStar || isLocked(item)) return;
    const others = props.value.filter((c) => idOf(c) !== idOf(item));
    props.onChange([item, ...others]);
  };

  const createAndAdd = async () => {
    const name = eng.trimmedQuery();
    if (!name || eng.creating() || !props.onCreate) return;
    eng.setCreating(true);
    eng.setError(null);
    try {
      const created = await props.onCreate(name);
      addToPool(created);
    } catch (e) {
      eng.setError(e instanceof Error ? e.message : `Failed to create ${props.noun}`);
    } finally {
      eng.setCreating(false);
    }
  };

  const selectOption = (opt: DisplayOption<T>) => {
    if (opt.create) {
      void createAndAdd();
      return;
    }
    addToPool(opt.item);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (props.disabled) return;
    if (e.key === "Escape") {
      eng.setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!eng.open()) eng.setOpen(true);
      const max = displayOptions().length - 1;
      setFocusedIdx((i) => (e.key === "ArrowDown" ? (i >= max ? 0 : i + 1) : i <= 0 ? max : i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = displayOptions()[focusedIdx()];
      if (opt) selectOption(opt);
      return;
    }
    if (e.key === "Backspace" && eng.query() === "" && props.value.length > 0) {
      removeFromPool(props.value[props.value.length - 1]!);
    }
  };

  onMount(() => {
    if (props.autoFocusOnMount) queueMicrotask(() => inputRef?.focus());
  });

  const Icon = props.icon;
  const isEmpty = () => props.value.length === 0;

  const wrapperTone = () => {
    if (props.disabled) return "opacity-60 cursor-not-allowed bg-zinc-800/30 border-zinc-700/50";
    if (props.invalid)
      return "bg-red-500/5 border-red-500/40 hover:bg-red-500/10 hover:border-red-500/60";
    return "bg-zinc-800/30 border-zinc-700/50 hover:border-amber-500/40 focus-within:border-amber-500/60";
  };

  return (
    <div
      ref={wrapperRef}
      class="relative w-full"
      {...(props.autoFocusOnMount ? { "data-autofocus": true } : {})}
    >
      {/* The wrapper is a styled click target that forwards focus to the inner
          input (which owns the keyboard surface). role="presentation" keeps the
          a11y tree clean about the bare-div onClick. */}
      <div
        data-testid={tid("control")}
        role="presentation"
        class={`w-full flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-colors text-sm cursor-text ${wrapperTone()}`}
        onClick={() => {
          if (props.disabled) return;
          inputRef?.focus();
          if (!eng.open()) eng.setOpen(true);
        }}
      >
        <For each={props.value}>
          {(item, i) => {
            const locked = () => isLocked(item);
            const primary = () => props.primaryStar === true && i() === 0;
            return (
              <span
                data-testid={`${tid("chip")}-${idOf(item)}`}
                class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  primary()
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
                    : "border-zinc-700 bg-zinc-800/40 text-zinc-200"
                }`}
              >
                <Show when={primary()}>
                  <Star size={10} class="text-amber-400 shrink-0" aria-label="Primary" />
                </Show>
                <Show
                  when={props.primaryStar}
                  fallback={<span class="truncate max-w-[140px]">{props.labelOf(item)}</span>}
                >
                  <button
                    type="button"
                    data-testid={`${tid("chip")}-${idOf(item)}-promote`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (props.disabled || locked() || i() === 0) return;
                      promoteToPrimary(item);
                    }}
                    disabled={props.disabled || locked() || i() === 0}
                    title={
                      props.disabled || locked()
                        ? "Anchored — can't be re-arranged."
                        : i() === 0
                          ? "Primary"
                          : "Promote to primary"
                    }
                    class="truncate max-w-[140px] text-left cursor-pointer disabled:cursor-default"
                  >
                    {props.labelOf(item)}
                  </button>
                </Show>
                <Show when={!props.disabled && !locked()}>
                  <button
                    type="button"
                    data-testid={`${tid("chip")}-${idOf(item)}-remove`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromPool(item);
                    }}
                    aria-label={`Remove ${props.labelOf(item)}`}
                    class="shrink-0 rounded-full p-0.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                </Show>
              </span>
            );
          }}
        </For>
        <Show when={isEmpty()}>
          <Icon size={14} class={`shrink-0 ml-1 ${props.invalid ? "text-red-300" : "text-zinc-400"}`} />
        </Show>
        <input
          ref={inputRef}
          type="text"
          aria-label={`Pick a ${props.noun}`}
          data-testid={tid("input")}
          disabled={props.disabled}
          value={eng.query()}
          placeholder={isEmpty() ? props.placeholder ?? `Walk-in — type to pick a ${props.noun}` : ""}
          onInput={(e) => {
            eng.setQuery(e.currentTarget.value);
            if (!eng.open()) eng.setOpen(true);
          }}
          onKeyDown={onKeyDown}
          class={`flex-1 min-w-[120px] bg-transparent outline-none text-sm text-zinc-100 ${
            props.invalid && isEmpty() ? "placeholder-red-300/80 italic" : "placeholder-zinc-500"
          }`}
        />
      </div>

      <Show when={eng.open() && !props.disabled}>
        <Portal>
          <div
            ref={popupRef}
            data-testid={tid("popup")}
            role="listbox"
            aria-label={`${props.noun} search results`}
            class="z-[110] rounded-md border border-zinc-700 bg-zinc-900/95 backdrop-blur shadow-xl overflow-hidden flex flex-col"
            style={eng.popupStyle()}
          >
            <Show when={eng.error()}>
              <div role="status" class="px-3 py-2 text-xs text-red-400 border-b border-zinc-800">
                {eng.error()}
              </div>
            </Show>
            <div class="flex-1 overflow-y-auto">
              <Show when={eng.loading() && eng.results().length === 0}>
                <div role="status" class="px-3 py-3 text-xs text-zinc-500 italic">Searching…</div>
              </Show>
              <Show when={displayOptions().length === 0 && !eng.loading()}>
                <div role="status" class="px-3 py-3 text-xs text-zinc-500 italic">
                  {eng.trimmedQuery() ? `No matching ${props.noun}s.` : `Start typing to find a ${props.noun}…`}
                </div>
              </Show>
              {/* The create row (index 0 when shown) is rendered separately from
                  the results so the results <For> iterates the STABLE search-result
                  objects and reconciles by reference — selecting one removes just
                  that node instead of tearing the whole list down (which flickered).
                  Keyboard focus still indexes the combined list: 0 = create row,
                  results start after it. */}
              <Show when={showCreateOption()}>
                <button
                  type="button"
                  role="option"
                  aria-selected={focusedIdx() === 0}
                  data-testid={tid("create")}
                  onMouseEnter={() => setFocusedIdx(0)}
                  onClick={() => void createAndAdd()}
                  disabled={eng.creating()}
                  class={`w-full flex items-start gap-2 px-3 py-2 text-left text-sm transition-colors border-b border-zinc-800 ${
                    focusedIdx() === 0 ? "bg-amber-500/15 text-amber-200" : "text-zinc-100 hover:bg-zinc-800"
                  }`}
                >
                  <Show
                    when={!eng.creating()}
                    fallback={<Loader2 size={14} class="animate-spin text-emerald-400 shrink-0 mt-0.5" />}
                  >
                    <UserPlus size={14} class="text-emerald-400 shrink-0 mt-0.5" />
                  </Show>
                  <span class="flex-1 text-emerald-300">
                    New {props.noun} "<span class="font-medium">{eng.trimmedQuery()}</span>"
                  </span>
                </button>
              </Show>
              <For each={filteredResults()}>
                {(item, i) => {
                  const displayIdx = () => i() + (showCreateOption() ? 1 : 0);
                  const isFocused = () => focusedIdx() === displayIdx();
                  const secondary = () => props.secondaryOf?.(item) ?? null;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={isFocused()}
                      data-testid={`${tid("result")}-${idOf(item)}`}
                      onMouseEnter={() => setFocusedIdx(displayIdx())}
                      onClick={() => addToPool(item)}
                      class={`w-full flex items-start gap-2 px-3 py-2 text-left text-sm transition-colors ${
                        isFocused() ? "bg-amber-500/15 text-amber-200" : "text-zinc-100 hover:bg-zinc-800"
                      }`}
                    >
                      <Icon size={14} class="text-zinc-500 shrink-0 mt-0.5" />
                      <span class="flex-1 min-w-0">
                        <span class="block truncate font-medium">
                          {highlightMatch(props.labelOf(item), eng.debouncedQuery().trim())}
                        </span>
                        <Show when={secondary()}>
                          <span class="block truncate text-[11px] text-zinc-500">
                            {highlightMatch(secondary()!, eng.debouncedQuery().trim())}
                          </span>
                        </Show>
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
