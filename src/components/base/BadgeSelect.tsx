import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

export interface BadgeSelectOption {
  /** Stable identity of the option (what `value` matches and `onChange` emits). */
  value: string;
  label: string;
  description?: string;
}

export interface BadgeSelectProps {
  /** Currently-selected option value. */
  value: string;
  options: BadgeSelectOption[];
  disabled?: boolean;
  loading?: boolean;
  /** Map the selected value to the trigger badge's classes (DI). Defaults to a
   *  neutral zinc chip — the caller injects its own tone mapping. */
  badgeClass?: (value: string) => string;
  onChange: (next: string) => void | Promise<void>;
  /** Show the inline search box when options exceed this count. Default 5. */
  searchThreshold?: number;
  searchPlaceholder?: string;
  /** Tooltip on the trigger when enabled. Default "Click to change". */
  title?: string;
  /** Empty-state copy when there are no options at all. Default "No options". */
  emptyLabel?: string;
  /** Empty-state copy when a search filters everything out. Default "No matching options". */
  emptyFilteredLabel?: string;
  /** Copy shown while `loading`. Default "Loading…". */
  loadingLabel?: string;
  testId?: string;
}

const POPUP_MIN_WIDTH = 200;
const POPUP_MAX_HEIGHT = 320;
const DEFAULT_SEARCH_THRESHOLD = 5;

// Inline, click-to-edit badge picker. Renders as a clickable badge; clicking
// opens a dropdown anchored to the badge with all options. When more than
// `searchThreshold` options are present an inline search box auto-appears so a
// long list stays scannable. Selecting commits immediately via onChange.
//
// The popup is rendered into a Portal with `position: fixed`, so it escapes
// ancestors that have `overflow: hidden` (e.g. rounded card containers) and
// flips above the trigger when there isn't enough room below it.
//
// Domain-free: the caller supplies the options, the value↔label mapping, and
// (optionally) the badge tone via `badgeClass`. Nothing here knows what the
// values mean.
//
// Intentionally distinct from SearchableSelect: this is a badge-scoped single
// select — a compact inline chip trigger plus per-value tone DI (`badgeClass`),
// not a form-control picker. Kept separate so neither component grows a
// trigger-shape/styling switch; do not merge them.
export default function BadgeSelect(props: BadgeSelectProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});
  let triggerRef: HTMLButtonElement | undefined;
  let popupRef: HTMLDivElement | undefined;
  let searchRef: HTMLInputElement | undefined;

  const threshold = () => props.searchThreshold ?? DEFAULT_SEARCH_THRESHOLD;
  const showSearch = () => (props.options?.length ?? 0) > threshold();

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return props.options;
    return props.options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.description?.toLowerCase().includes(q) ?? false),
    );
  });

  const defaultBadge = () => "bg-zinc-800 text-zinc-400 border border-transparent";
  const badgeClass = () => props.badgeClass?.(props.value) ?? defaultBadge();

  const emptyStateMessage = () => {
    if (props.loading) return props.loadingLabel ?? "Loading…";
    return query() ? (props.emptyFilteredLabel ?? "No matching options") : (props.emptyLabel ?? "No options");
  };

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
      160,
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
    setQuery("");
    updatePosition();
    if (showSearch()) queueMicrotask(() => searchRef?.focus());

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef?.contains(target)) return;
      if (popupRef?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReflow = () => updatePosition();

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    });
  });

  const handleSelect = async (next: string) => {
    if (next === props.value) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await props.onChange(next);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const currentLabel = () =>
    props.options.find((o) => o.value === props.value)?.label ?? props.value;

  return (
    <div class="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        data-testid={props.testId}
        aria-haspopup="listbox"
        aria-expanded={open()}
        disabled={props.disabled || busy()}
        onClick={() => !props.disabled && setOpen((o) => !o)}
        class={`text-xs font-medium px-1.5 py-0.5 rounded cursor-pointer transition-colors hover:ring-1 hover:ring-amber-500/40 ${badgeClass()} ${
          props.disabled ? "cursor-not-allowed opacity-60" : ""
        }`}
        title={props.disabled ? "" : (props.title ?? "Click to change")}
      >
        {busy() ? "…" : currentLabel()}
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={popupRef}
            role="listbox"
            class="z-[100] rounded-md border border-zinc-700 bg-zinc-900/95 backdrop-blur shadow-xl overflow-hidden flex flex-col"
            style={popupStyle()}
          >
            <Show when={showSearch()}>
              <div class="px-2 py-1.5 border-b border-zinc-800">
                <input
                  ref={searchRef}
                  type="text"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  placeholder={props.searchPlaceholder ?? "Search…"}
                  class="w-full px-2 py-1 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
                />
              </div>
            </Show>
            <div class="flex-1 overflow-y-auto">
              <Show
                when={!props.loading && filtered().length > 0}
                fallback={<div class="px-3 py-2 text-xs text-zinc-500">{emptyStateMessage()}</div>}
              >
                <For each={filtered()}>
                  {(opt) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={opt.value === props.value}
                      onClick={() => handleSelect(opt.value)}
                      class={`w-full text-left px-3 py-2 text-xs hover:bg-amber-500/10 transition-colors flex items-center justify-between gap-2 ${
                        opt.value === props.value ? "text-amber-400" : "text-zinc-200"
                      }`}
                    >
                      <span class="flex flex-col">
                        <span class="font-medium">{opt.label}</span>
                        <Show when={opt.description}>
                          <span class="text-[10px] text-zinc-500">{opt.description}</span>
                        </Show>
                      </span>
                      <Show when={opt.value === props.value}>
                        <span class="text-amber-400" aria-hidden="true">✓</span>
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
