import { createSignal, For, onCleanup, onMount, Show, type Component, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import ChevronDown from "lucide-solid/icons/chevron-down";

/** A lucide-solid icon component (or any component taking size/class). */
type IconComponent = Component<{ size?: number; class?: string }>;

/** The status of a dropdown item, used to render a small leading colored dot
 *  when no explicit icon is supplied. Domain-free: the caller maps its own
 *  enum onto one of these three presentational states. */
export type DropdownItemStatus = "open" | "closed" | "neutral";

export interface DropdownItem {
  /** Stable identity, matched against the selected `value`. */
  id: string;
  /** Primary text shown for the item and on the trigger when selected. */
  label: string;
  /** Optional secondary line under the label. */
  description?: string;
  /** Arbitrary payload handed back to `onSelect` unchanged. */
  value?: unknown;
  /** Optional leading icon. Takes precedence over the status dot. */
  icon?: IconComponent;
  /** Optional pill rendered beside the label. */
  badge?: string;
  /** When true the item is dimmed and not selectable. */
  disabled?: boolean;
  /** When no `icon` is set, renders a small colored status dot. */
  status?: DropdownItemStatus;
}

export interface DropdownProps {
  /** The selectable options, top to bottom. */
  items: DropdownItem[];
  /** The currently selected item's `id`. Uncontrolled fallback selects the first item. */
  value?: string;
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  /** Optional leading icon on the trigger button. */
  icon?: IconComponent;
  /** Minimum width of the trigger/menu (any CSS length). Defaults to 280px. */
  minWidth?: string;
  /** Disables the whole control. */
  disabled?: boolean;
  /** Called with the chosen item when an option is selected. */
  onSelect?: (item: DropdownItem) => void;
  /** Extra classes on the outer container. */
  class?: string;
}

// Maps a presentational status to a dot color. Domain-free: only the three
// status states are recognized; everything else falls back to neutral gray.
function statusColor(status?: DropdownItemStatus): string {
  switch (status) {
    case "open":
      return "var(--ks-success, #10b981)";
    case "closed":
      return "var(--ks-fg-muted, #a1a1aa)";
    default:
      return "var(--ks-fg-muted, #a1a1aa)";
  }
}

// A generic single-select dropdown: a labeled trigger that opens a panel of
// items, each optionally carrying a description, icon (or status dot), and
// badge. Click-outside closes the panel; the chevron rotates while open.
// Presentational only and domain-free — no baked-in copy or business literals.
export default function Dropdown(props: DropdownProps): JSX.Element {
  const [isOpen, setIsOpen] = createSignal(false);
  const [selectedItem, setSelectedItem] = createSignal<DropdownItem | undefined>(
    props.items.find((item) => item.id === props.value),
  );

  const currentSelection = () => selectedItem() ?? props.items.find((i) => i.id === props.value) ?? props.items[0];

  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest("[data-dropdown-container]")) {
        setIsOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    onCleanup(() => document.removeEventListener("click", handleClickOutside));
  });

  const handleSelect = (item: DropdownItem) => {
    if (item.disabled) return;
    setSelectedItem(item);
    setIsOpen(false);
    props.onSelect?.(item);
  };

  return (
    <div class={`relative inline-block ${props.class ?? ""}`} data-dropdown-container>
      <button
        onClick={() => !props.disabled && setIsOpen(!isOpen())}
        disabled={props.disabled}
        class={`flex items-center gap-3 px-4 py-3 bg-[color-mix(in_srgb,var(--ks-surface,#0f0f0f)_50%,transparent)] border border-[var(--ks-border,rgba(39,39,42,0.5))] rounded-lg hover:bg-[color-mix(in_srgb,var(--ks-surface,#0f0f0f)_70%,transparent)] transition-all backdrop-blur-sm select-none ${
          props.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
        }`}
        style={{ "min-width": props.minWidth ?? "280px" }}
      >
        <Show when={props.icon}>
          {(Icon) => <Dynamic component={Icon()} size={18} class="text-[var(--ks-accent,#fbbf24)]" />}
        </Show>
        <div class="flex-1 text-left">
          <div class="font-semibold text-[var(--ks-fg,#ffffff)]">
            {currentSelection()?.label ?? props.placeholder ?? "Select an option"}
          </div>
          <Show when={currentSelection()?.description}>
            <div class="text-xs text-[var(--ks-fg-muted,#a1a1aa)]">{currentSelection()?.description}</div>
          </Show>
        </div>
        <ChevronDown size={18} class={`text-[var(--ks-fg-muted,#a1a1aa)] transition-transform ${isOpen() ? "rotate-180" : ""}`} />
      </button>

      <Show when={isOpen()}>
        <div class="absolute top-full left-0 mt-2 w-full bg-[color-mix(in_srgb,var(--ks-surface,#0f0f0f)_95%,transparent)] border border-[var(--ks-border,rgba(39,39,42,0.5))] rounded-lg backdrop-blur-xl z-50 shadow-xl select-none">
          <For each={props.items}>
            {(item) => (
              <button
                onClick={() => handleSelect(item)}
                disabled={item.disabled}
                class={`w-full px-4 py-3 flex items-center gap-3 hover:bg-[color-mix(in_srgb,var(--ks-surface-raised,#1a1a1a)_50%,transparent)] transition-all first:rounded-t-lg last:rounded-b-lg select-none ${
                  currentSelection()?.id === item.id ? "bg-[color-mix(in_srgb,var(--ks-surface-raised,#1a1a1a)_30%,transparent)]" : ""
                } ${item.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div class="flex items-center gap-2 flex-shrink-0">
                  <Show
                    when={item.icon}
                    fallback={
                      <Show when={item.status}>
                        <div
                          class="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: statusColor(item.status) }}
                        />
                      </Show>
                    }
                  >
                    {(Icon) => <Dynamic component={Icon()} size={16} class="text-[var(--ks-accent,#fbbf24)]" />}
                  </Show>
                </div>
                <div class="flex-1 text-left min-w-0">
                  <div class="font-medium text-[var(--ks-fg,#ffffff)] flex items-center gap-2">
                    {item.label}
                    <Show when={item.badge}>
                      <span class="px-2 py-0.5 text-xs font-medium bg-[color-mix(in_srgb,var(--ks-surface-sunken,#141414)_50%,transparent)] text-[var(--ks-fg-muted,#a1a1aa)] rounded flex-shrink-0">
                        {item.badge}
                      </span>
                    </Show>
                  </div>
                  <Show when={item.description}>
                    <div class="text-xs text-[var(--ks-fg-muted,#a1a1aa)] truncate">{item.description}</div>
                  </Show>
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
