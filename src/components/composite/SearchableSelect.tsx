import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import X from "lucide-solid/icons/x";

export interface SearchableOption {
  value: string | number;
  label: string;
  description?: string;
}

export interface SearchableSelectProps {
  value: string | number | null | undefined;
  options: SearchableOption[];
  onChange: (next: SearchableOption | null) => void | Promise<void>;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  loading?: boolean;
  allowClear?: boolean;
  wrapperClass?: string;
  triggerClass?: string;
  triggerTestId?: string;
  triggerLabelClass?: string;
  emptyLabel?: string;
  noMatchLabel?: string;
}

const POPUP_MIN_WIDTH = 240;
const POPUP_MAX_HEIGHT = 320; // keep in sync with max-h-80 below
// Flip the popup above the trigger only when the space below can't fit a
// usable list. Below this many px we'd rather open upward (if there's more room
// there) than cramp the results.
const POPUP_FLIP_THRESHOLD = 200;

// Click-to-open combobox with inline search. The popup is rendered into a
// Portal and positioned with `position: fixed`, so it can escape any ancestor
// with `overflow: hidden` (e.g. the rounded table cards) and flip upward when
// there's not enough room below the trigger.
export default function SearchableSelect(props: SearchableSelectProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});
  let triggerRef: HTMLButtonElement | undefined;
  let popupRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  const currentLabel = () => {
    if (props.value == null || props.value === "") return undefined;
    return props.options.find((o) => String(o.value) === String(props.value))?.label;
  };

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return props.options;
    return props.options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || (o.description?.toLowerCase().includes(q) ?? false),
    );
  });

  const updatePosition = () => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const vpHeight = window.innerHeight;
    const vpWidth = window.innerWidth;
    const width = Math.max(POPUP_MIN_WIDTH, rect.width);
    const spaceBelow = vpHeight - rect.bottom;
    const spaceAbove = rect.top;
    // Only flip upward when there isn't enough usable room below AND there's
    // genuinely more room above. Anchor the flipped popup by its BOTTOM (hugging
    // the trigger) instead of computing a top from POPUP_MAX_HEIGHT, so a short
    // result list stays adjacent to the trigger rather than floating far above it.
    const flipUp = spaceBelow < POPUP_FLIP_THRESHOLD && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      160,
      Math.min(POPUP_MAX_HEIGHT, (flipUp ? spaceAbove : spaceBelow) - 12),
    );
    // Clamp horizontally so the popup doesn't overflow the viewport edges.
    const left = Math.min(Math.max(8, rect.left), vpWidth - width - 8);
    setPopupStyle({
      position: "fixed",
      ...(flipUp
        ? { bottom: `${Math.max(8, vpHeight - rect.top + 4)}px` }
        : { top: `${rect.bottom + 4}px` }),
      left: `${left}px`,
      width: `${width}px`,
      "max-height": `${maxHeight}px`,
    });
  };

  createEffect(() => {
    if (!open()) return;
    // Initial measurement + focus + listeners.
    updatePosition();
    queueMicrotask(() => inputRef?.focus());

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef?.contains(target)) return;
      if (popupRef?.contains(target)) return;
      setOpen(false);
      setQuery("");
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    const onReflow = () => updatePosition();

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", onReflow);
    // Capture phase so we catch scrolls in every ancestor.
    window.addEventListener("scroll", onReflow, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    });
  });

  const emptyStateLabel = () => {
    if (props.loading) return "Loading…";
    if (query()) return props.noMatchLabel ?? "No matches";
    return props.emptyLabel ?? "No options";
  };

  const select = async (opt: SearchableOption | null) => {
    setBusy(true);
    try {
      await props.onChange(opt);
    } finally {
      setBusy(false);
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div class={props.wrapperClass ?? "relative inline-block"}>
      <button
        ref={triggerRef}
        type="button"
        data-testid={props.triggerTestId}
        disabled={props.disabled || busy()}
        onClick={() => !props.disabled && setOpen((o) => !o)}
        class={
          props.triggerClass ??
          "inline-flex items-center gap-1.5 text-xs text-zinc-300 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 rounded px-2 py-1 cursor-pointer transition-colors"
        }
        classList={{ "cursor-not-allowed opacity-60": props.disabled }}
        title={props.disabled ? undefined : "Click to select"}
      >
        <span class={props.triggerLabelClass ?? "truncate max-w-[180px]"}>
          {busy()
            ? "…"
            : (currentLabel() ?? (
                <span class="text-zinc-500 italic">{props.placeholder ?? "Select…"}</span>
              ))}
        </span>
        <ChevronsUpDown size={12} class="text-zinc-500 shrink-0" />
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={popupRef}
            class="z-[100] rounded-md border border-zinc-700 bg-zinc-900/95 backdrop-blur shadow-xl overflow-hidden flex flex-col"
            style={popupStyle()}
          >
            <div class="px-2 py-1.5 border-b border-zinc-800">
              <input
                ref={inputRef}
                type="text"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                placeholder={props.searchPlaceholder ?? "Search…"}
                class="w-full px-2 py-1 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <div class="flex-1 overflow-y-auto">
              <Show
                when={!props.loading && filtered().length > 0}
                fallback={
                  <div class="px-3 py-3 text-xs text-zinc-500 text-center">{emptyStateLabel()}</div>
                }
              >
                <For each={filtered()}>
                  {(opt) => {
                    const selected = () => String(opt.value) === String(props.value ?? "");
                    return (
                      <button
                        type="button"
                        onClick={() => select(opt)}
                        class="w-full text-left px-3 py-2 text-xs hover:bg-amber-500/10 transition-colors flex items-center justify-between gap-2"
                        classList={{
                          "text-amber-400": selected(),
                          "text-zinc-200": !selected(),
                        }}
                      >
                        <span class="flex flex-col min-w-0">
                          <span class="font-medium truncate">{opt.label}</span>
                          <Show when={opt.description}>
                            <span class="text-[10px] text-zinc-500 truncate">
                              {opt.description}
                            </span>
                          </Show>
                        </span>
                        <Show when={selected()}>
                          <span class="text-amber-400 shrink-0">✓</span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </Show>
            </div>
            <Show when={props.allowClear && props.value != null && props.value !== ""}>
              <div class="border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => select(null)}
                  class="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                >
                  <X size={12} />
                  <span>Clear selection</span>
                </button>
              </div>
            </Show>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
