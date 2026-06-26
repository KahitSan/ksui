// Source: KahitSan/kserp src/components/transactions/TransactionFilters.tsx (vendored verbatim).
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type Component,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Check from "lucide-solid/icons/check";
import Filter from "lucide-solid/icons/filter";
import CalendarDays from "lucide-solid/icons/calendar-days";
import ArrowDownLeft from "lucide-solid/icons/arrow-down-left";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import ArrowRightLeft from "lucide-solid/icons/arrow-right-left";
import Tag from "lucide-solid/icons/tag";
import Wallet from "lucide-solid/icons/wallet";
import CircleDot from "lucide-solid/icons/circle-dot";
import Coins from "lucide-solid/icons/coins";
import User from "lucide-solid/icons/user";

// Single source of truth for the popover dimensions. Kept above the
// component so the position calculator can reference them without a re-
// render dance.
const POPUP_WIDTH = 260;
const POPUP_MAX_HEIGHT = 360;

interface IconLike {
  (props: { size?: number; class?: string }): JSX.Element;
}

const CATEGORY_DEFS: { id: string; label: string; icon: IconLike }[] = [
  { id: "sale", label: "Revenue", icon: ArrowDownLeft },
  { id: "expense", label: "Expense", icon: ArrowUpRight },
  { id: "payable", label: "Payable", icon: CalendarDays },
  { id: "business", label: "Transfer", icon: ArrowRightLeft },
];

const PDC_DEFS: { id: string; label: string; dot: string }[] = [
  { id: "issued", label: "PDC issued", dot: "bg-amber-400" },
  { id: "presented", label: "PDC presented", dot: "bg-blue-400" },
  { id: "cleared", label: "PDC cleared", dot: "bg-emerald-400" },
  { id: "bounced", label: "PDC bounced", dot: "bg-red-400" },
];

const STATUS_DEFS: { id: string; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "voided", label: "Voided" },
  { id: "all", label: "All" },
];

type PropertyId = "type" | "pdc" | "status" | "account" | "category" | "by";

const PROPERTY_DEFS: { id: PropertyId; label: string; icon: IconLike }[] = [
  { id: "type", label: "Type", icon: Coins },
  { id: "pdc", label: "PDC", icon: CalendarDays },
  { id: "status", label: "Status", icon: CircleDot },
  { id: "account", label: "Account", icon: Wallet },
  { id: "category", label: "Category", icon: Tag },
  { id: "by", label: "By", icon: User },
];

export interface CreatorOption {
  id: string;
  name: string;
  image?: string | null;
  count?: number;
}

export interface TransactionFiltersProps {
  // active filter state — accessors so the popover stays reactive
  activeCategories: () => Set<string>;
  pdcFilter: () => Set<string>;
  statusFilter: () => string;
  accountFilter: () => string;
  subcategoryFilter: () => string;
  createdByFilter: () => string;

  // mutators
  setActiveCategories: (s: Set<string>) => void;
  setPdcFilter: (s: Set<string>) => void;
  setStatusFilter: (v: string) => void;
  setAccountFilter: (v: string) => void;
  setSubcategoryFilter: (v: string) => void;
  setCreatedByFilter: (v: string) => void;

  // dropdown source data
  accounts: () => { id: number; name: string }[];
  subcategoryOptions: () => string[];
  subcategoryCounts: () => Record<string, number>;
  creators: () => CreatorOption[];

  // global controls
  activeFilterCount: () => number;
  clearAllFilters: () => void;

  // group-sales toggle stays a visible peer button (preserves the
  // existing e2e testid contract and the discoverability of a view-mode
  // switch). We render it on the right of the row.
  groupSalesByDay: () => boolean;
  setGroupSalesByDay: (v: boolean) => void;
}

/**
 * Notion-style filter cluster for the Transactions table.
 *
 * Active filters render as pills on the left. A `+ Filter` button on the
 * right opens a single popover with two screens:
 *   1. Property picker — searchable list of every filterable property.
 *   2. Value editor    — multi-select for Type/PDC, single-select for the
 *                        rest. A back arrow returns to the property list
 *                        without closing the popover.
 *
 * Clicking an active pill jumps straight to its value editor.
 *
 * Every mutation calls the parent setters and ONLY the parent setters.
 * Refetch is driven by the route's centralized createEffect that watches
 * those signals — by design this component never calls resetAndRefetch.
 */
export default function TransactionFilters(
  props: TransactionFiltersProps
): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<PropertyId | null>(null);
  const [query, setQuery] = createSignal("");
  const [valueQuery, setValueQuery] = createSignal("");
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});
  // The element that opened the current popup. Lives in a signal so
  // bindings like `aria-expanded` re-evaluate when the anchor changes
  // (clicking a pill while the popup is open swaps the anchor without
  // toggling `open()`). Reading a plain `let` here would leave the
  // attribute stuck on its first value until `open()` flipped.
  const [anchorEl, setAnchorEl] = createSignal<HTMLElement | undefined>();

  let triggerRef: HTMLButtonElement | undefined;
  let popupRef: HTMLDivElement | undefined;
  let searchRef: HTMLInputElement | undefined;
  let valueSearchRef: HTMLInputElement | undefined;

  // Predicates: which properties currently have a non-default value? Used
  // both for rendering pills and for hiding "already-set" entries from
  // the picker. Hiding isn't strictly necessary, but it nudges the user
  // to edit the pill instead of stacking duplicates.
  const isActive = (id: PropertyId): boolean => {
    switch (id) {
      case "type":
        return props.activeCategories().size > 0;
      case "pdc":
        return props.pdcFilter().size > 0;
      case "status":
        return props.statusFilter() !== "active";
      case "account":
        return props.accountFilter() !== "";
      case "category":
        return props.subcategoryFilter() !== "";
      case "by":
        return props.createdByFilter() !== "";
    }
  };

  // Human-readable summary of an active filter, shown on the pill.
  const valueLabel = (id: PropertyId): string => {
    switch (id) {
      case "type": {
        const names = CATEGORY_DEFS.filter((c) =>
          props.activeCategories().has(c.id)
        ).map((c) => c.label);
        if (names.length === 0) return "";
        if (names.length <= 2) return names.join(", ");
        return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
      }
      case "pdc": {
        const names = PDC_DEFS.filter((p) => props.pdcFilter().has(p.id)).map(
          (p) => p.label.replace("PDC ", "")
        );
        if (names.length === 0) return "";
        if (names.length <= 2) return names.join(", ");
        return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
      }
      case "status":
        return (
          STATUS_DEFS.find((s) => s.id === props.statusFilter())?.label ?? ""
        );
      case "account": {
        const id = Number(props.accountFilter());
        return props.accounts().find((a) => a.id === id)?.name ?? "Account";
      }
      case "category":
        return props.subcategoryFilter() || "";
      case "by": {
        const id = props.createdByFilter();
        return props.creators().find((c) => c.id === id)?.name ?? "User";
      }
    }
  };

  // Reset just one property to its default. The clear-all path lives on
  // the parent; we never reach across to it because the per-property
  // reset is tactical (one click on a pill's ×).
  const clearProperty = (id: PropertyId): void => {
    switch (id) {
      case "type":
        props.setActiveCategories(new Set());
        break;
      case "pdc":
        props.setPdcFilter(new Set());
        break;
      case "status":
        props.setStatusFilter("active");
        break;
      case "account":
        props.setAccountFilter("");
        break;
      case "category":
        props.setSubcategoryFilter("");
        break;
      case "by":
        props.setCreatedByFilter("");
        break;
    }
  };

  const filteredProperties = createMemo(() => {
    const q = query().trim().toLowerCase();
    const all = PROPERTY_DEFS;
    if (!q) return all;
    return all.filter((p) => p.label.toLowerCase().includes(q));
  });

  // Position the popover under the anchor button. Mirrors the
  // SearchableSelect logic so a row that's near the viewport edge flips
  // upward instead of clipping. Width is fixed so the two screens line
  // up; height adapts to the available space.
  const updatePosition = (): void => {
    const anchor = anchorEl() ?? triggerRef;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const spaceBelow = vpH - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp = spaceBelow < POPUP_MAX_HEIGHT && spaceAbove > spaceBelow;
    const top = flipUp
      ? Math.max(8, rect.top - POPUP_MAX_HEIGHT - 4)
      : rect.bottom + 4;
    const maxHeight = Math.max(
      200,
      Math.min(POPUP_MAX_HEIGHT, flipUp ? spaceAbove - 12 : spaceBelow - 12)
    );
    // Clamp horizontally so the fixed-width popup doesn't run off-screen
    // on a narrow viewport.
    const left = Math.min(Math.max(8, rect.left), vpW - POPUP_WIDTH - 8);
    setPopupStyle({
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${POPUP_WIDTH}px`,
      "max-height": `${maxHeight}px`,
    });
  };

  const openPicker = (
    anchor: HTMLElement | undefined,
    prop: PropertyId | null
  ): void => {
    setAnchorEl(anchor);
    setEditing(prop);
    setQuery("");
    setValueQuery("");
    setOpen(true);
  };

  // Listener lifecycle is tied to `open()` only. Drilling between the
  // property picker and the value editor changes `editing()` but must NOT
  // tear down and re-attach the document listeners — that left a one-tick
  // window where mousedown/keydown weren't bound and was wasteful in the
  // common case. Reposition + focus on drill-in/out live in the next
  // effect, which can churn freely because it's pure DOM work.
  createEffect(() => {
    if (!open()) return;

    const onDocClick = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (popupRef?.contains(t)) return;
      // Allow clicks on any pill or the + Filter trigger to fall through
      // to their own handlers without first closing the popup (which
      // would otherwise eat the second click on the same pill).
      if (triggerRef?.contains(t)) return;
      if (anchorEl()?.contains(t)) return;
      // A click on a DIFFERENT pill (one whose editor isn't open) must also
      // skip the close — otherwise mousedown closes the popup BEFORE the
      // pill's own click handler runs, the click then re-opens it, and the
      // user sees a one-frame flicker plus an effect re-run racing the
      // stale anchor signal. Walking up to find any filter pill ancestor
      // lets openPicker swap the anchor cleanly.
      const el = t instanceof Element ? t : t.parentElement ?? null;
      if (el?.closest('[data-testid^="filter-pill-"]')) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (editing()) {
        // First Escape closes the value editor and returns to the
        // property list; a second Escape closes the whole popup. This
        // mirrors how most popover stacks unwind one layer at a time.
        setEditing(null);
        queueMicrotask(() => searchRef?.focus());
      } else {
        setOpen(false);
      }
    };
    const onReflow = (): void => updatePosition();

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", onReflow);
    // Capture so we catch scrolls inside ancestors with their own overflow.
    window.addEventListener("scroll", onReflow, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    });
  });

  // Reposition + focus on every open/drill. The editor view is taller for
  // properties with long option lists and may need to flip; the focus
  // half satisfies the kserp auto-focus convention so a keyboard user can
  // type immediately on open AND after a back/forward drill. This effect
  // is pure DOM work — no listener registration — so it's safe to churn.
  createEffect(() => {
    const isOpen = open();
    const isEditing = editing();
    if (!isOpen) return;
    queueMicrotask(() => {
      updatePosition();
      if (isEditing) valueSearchRef?.focus();
      else searchRef?.focus();
    });
  });

  // Restore focus to whoever opened the popup when it closes. Without
  // this, closing via Escape, the Done footer, or click-outside leaves
  // focus on <body> (the portal node is gone), and keyboard users have
  // to tab from the top of the page again to resume.
  createEffect<boolean>((wasOpen) => {
    const isOpen = open();
    if (wasOpen && !isOpen) {
      // anchorEl() may be null if openPicker was passed an undefined
      // anchor; in that case there's no useful target to focus and
      // browser default (body) is the right fallback.
      anchorEl()?.focus();
    }
    return isOpen;
  }, false);

  return (
    <div class="flex items-center gap-2 flex-wrap">
      {/* Pills for active filters. Click body → edit; click × → clear. */}
      <For each={PROPERTY_DEFS}>
        {(prop) => (
          <Show when={isActive(prop.id)}>
            <FilterPill
              prop={prop}
              valueLabel={valueLabel(prop.id)}
              onEdit={(el) => openPicker(el, prop.id)}
              onClear={() => clearProperty(prop.id)}
            />
          </Show>
        )}
      </For>

      {/* The single entry point. + Filter when nothing is active, just
          "Filter" when pills are showing — keeps the row visually quiet
          once the user has set something. */}
      <button
        ref={triggerRef}
        type="button"
        data-testid="filter-trigger"
        onClick={() => {
          // Re-clicking the trigger while its own popup is open should
          // close it. Without this branch the click is interpreted as
          // "open again," which silently resets the picker view back to
          // the property list. Only collapse when this trigger's own
          // popup is open (a pill's popup is anchored elsewhere and
          // should be replaced, not closed).
          if (open() && anchorEl() === triggerRef) {
            setOpen(false);
            return;
          }
          openPicker(triggerRef, null);
        }}
        aria-haspopup="dialog"
        aria-expanded={open() && anchorEl() === triggerRef}
        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border ks-hud-clip-top-left-bottom-right transition-colors cursor-pointer border-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
        title="Add filter"
      >
        <Show
          when={props.activeFilterCount() === 0}
          fallback={<Filter size={12} />}
        >
          <Plus size={12} />
        </Show>
        Filter
      </button>

      {/* Group sales per day — a view mode, not a filter. Kept as a
          peer button so it stays one click away and the existing
          group-sales-toggle e2e contract holds (testid + aria-pressed). */}
      <button
        onClick={() => props.setGroupSalesByDay(!props.groupSalesByDay())}
        aria-pressed={props.groupSalesByDay()}
        data-testid="group-sales-toggle"
        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border ks-hud-clip-top-left-bottom-right transition-colors cursor-pointer"
        classList={{
          "bg-amber-500/15 border-amber-500/40 text-amber-400":
            props.groupSalesByDay(),
          "border-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700":
            !props.groupSalesByDay(),
        }}
        title="Group sales per day"
      >
        <CalendarDays size={12} />
        Group sales per day
      </button>

      <Show when={props.activeFilterCount() > 0}>
        <button
          onClick={props.clearAllFilters}
          class="text-xs text-zinc-500 hover:text-amber-400 px-2 py-1.5 flex items-center gap-1 cursor-pointer"
        >
          <X size={12} />
          Clear ({props.activeFilterCount()})
        </button>
      </Show>

      <Show when={open()}>
        <Portal>
          <div
            ref={popupRef}
            role="dialog"
            aria-modal="false"
            aria-label={
              editing()
                ? `Edit ${
                    PROPERTY_DEFS.find((d) => d.id === editing())?.label ?? ""
                  } filter`
                : "Add filter"
            }
            class="z-[100] rounded-md border border-zinc-700 bg-zinc-900/95 backdrop-blur shadow-xl overflow-hidden flex flex-col"
            style={popupStyle()}
          >
            <Show
              when={editing() !== null}
              fallback={
                <PropertyPicker
                  query={query}
                  setQuery={setQuery}
                  searchRef={(el) => (searchRef = el)}
                  filtered={filteredProperties}
                  isActive={isActive}
                  onPick={(id) => {
                    setEditing(id);
                    setValueQuery("");
                  }}
                />
              }
            >
              <ValueEditor
                editing={editing()!}
                onBack={() => setEditing(null)}
                onDone={() => setOpen(false)}
                valueQuery={valueQuery}
                setValueQuery={setValueQuery}
                valueSearchRef={(el) => (valueSearchRef = el)}
                props={props}
              />
            </Show>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

// One pill, rendered for every active property. The whole body is a
// button (click → re-open value editor for this property); the × is a
// nested button that stops propagation so it doesn't also open the
// editor. The pill carries `data-testid="filter-pill-<id>"` so e2e
// can read or click it without DOM-traversal gymnastics.
const FilterPill: Component<{
  prop: { id: PropertyId; label: string; icon: IconLike };
  valueLabel: string;
  onEdit: (el: HTMLElement) => void;
  onClear: () => void;
}> = (p) => {
  let ref: HTMLButtonElement | undefined;
  const Ico = p.prop.icon;
  return (
    <div class="inline-flex items-center gap-0 border ks-hud-clip-top-left-bottom-right border-amber-500/40 bg-amber-500/15 text-amber-400">
      <button
        ref={ref}
        type="button"
        data-testid={`filter-pill-${p.prop.id}`}
        onClick={(e) => {
          e.stopPropagation();
          p.onEdit(ref!);
        }}
        aria-label={`Edit ${p.prop.label} filter, currently set to ${p.valueLabel}`}
        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium cursor-pointer hover:bg-amber-500/25 transition-colors"
        title={`Edit ${p.prop.label} filter`}
      >
        <Ico size={12} />
        <span class="text-zinc-400">{p.prop.label}:</span>
        <span>{p.valueLabel}</span>
      </button>
      <button
        type="button"
        data-testid={`filter-pill-clear-${p.prop.id}`}
        onClick={(e) => {
          e.stopPropagation();
          p.onClear();
        }}
        aria-label={`Remove ${p.prop.label} filter`}
        class="px-1.5 py-1.5 hover:bg-amber-500/30 transition-colors cursor-pointer"
        title={`Remove ${p.prop.label} filter`}
      >
        <X size={12} />
      </button>
    </div>
  );
};

// Screen 1: searchable list of every filterable property. Active
// properties show a check on the right so the user can see at a glance
// what's already set without dismissing the popover.
const PropertyPicker: Component<{
  query: () => string;
  setQuery: (v: string) => void;
  searchRef: (el: HTMLInputElement) => void;
  filtered: () => { id: PropertyId; label: string; icon: IconLike }[];
  isActive: (id: PropertyId) => boolean;
  onPick: (id: PropertyId) => void;
}> = (p) => {
  return (
    <>
      <div class="px-2 py-1.5 border-b border-zinc-800">
        <input
          ref={p.searchRef}
          type="text"
          value={p.query()}
          onInput={(e) => p.setQuery(e.currentTarget.value)}
          placeholder="Filter by..."
          class="w-full px-2 py-1 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
        />
      </div>
      <div class="flex-1 overflow-y-auto">
        <Show
          when={p.filtered().length > 0}
          fallback={
            <div class="px-3 py-3 text-xs text-zinc-500 text-center">
              No matching properties
            </div>
          }
        >
          <For each={p.filtered()}>
            {(prop) => {
              const Ico = prop.icon;
              return (
                <button
                  type="button"
                  data-testid={`filter-property-${prop.id}`}
                  onClick={() => p.onPick(prop.id)}
                  class="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-amber-500/10 transition-colors cursor-pointer text-zinc-200"
                >
                  <span class="flex items-center gap-2">
                    <Ico size={14} class="text-zinc-500" />
                    {prop.label}
                  </span>
                  <Show
                    when={p.isActive(prop.id)}
                    fallback={<ChevronRight size={14} class="text-zinc-600" />}
                  >
                    <Check size={14} class="text-amber-400" />
                  </Show>
                </button>
              );
            }}
          </For>
        </Show>
      </div>
    </>
  );
};

// Screen 2: value editor for the chosen property. The same back arrow
// works for all property types so the user always has a way out. Each
// property type renders its own body: multi-select for Type/PDC,
// single-select for the rest. The "Done" footer applies the same
// across all types — closes the popup.
const ValueEditor: Component<{
  editing: PropertyId;
  onBack: () => void;
  onDone: () => void;
  valueQuery: () => string;
  setValueQuery: (v: string) => void;
  valueSearchRef: (el: HTMLInputElement) => void;
  props: TransactionFiltersProps;
}> = (p) => {
  const def = () => PROPERTY_DEFS.find((d) => d.id === p.editing)!;

  return (
    <>
      <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-800">
        <button
          type="button"
          onClick={p.onBack}
          aria-label="Back to properties"
          class="p-1 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
          title="Back to properties"
        >
          <ChevronLeft size={14} class="text-zinc-400" />
        </button>
        <span class="text-xs text-zinc-300 font-medium flex-1">
          {def().label}
        </span>
        <button
          type="button"
          onClick={p.onDone}
          class="text-[10px] uppercase tracking-wider text-zinc-500 hover:text-amber-400 px-2 cursor-pointer"
        >
          Done
        </button>
      </div>

      <Show when={p.editing === "type"}>
        <MultiSelectList
          options={CATEGORY_DEFS.map((c) => ({
            value: c.id,
            label: c.label,
            icon: c.icon,
          }))}
          selected={p.props.activeCategories}
          onToggle={(v) => {
            const next = new Set(p.props.activeCategories());
            if (next.has(v)) next.delete(v);
            else next.add(v);
            p.props.setActiveCategories(next);
          }}
          query={p.valueQuery}
          setQuery={p.setValueQuery}
          searchRef={p.valueSearchRef}
          testidPrefix="filter-value-type"
        />
      </Show>

      <Show when={p.editing === "pdc"}>
        <MultiSelectList
          options={PDC_DEFS.map((d) => ({
            value: d.id,
            label: d.label,
            dot: d.dot,
          }))}
          selected={p.props.pdcFilter}
          onToggle={(v) => {
            const next = new Set(p.props.pdcFilter());
            if (next.has(v)) next.delete(v);
            else next.add(v);
            p.props.setPdcFilter(next);
          }}
          query={p.valueQuery}
          setQuery={p.setValueQuery}
          searchRef={p.valueSearchRef}
          testidPrefix="filter-value-pdc"
        />
      </Show>

      <Show when={p.editing === "status"}>
        <SingleSelectList
          options={STATUS_DEFS.map((s) => ({ value: s.id, label: s.label }))}
          selected={p.props.statusFilter}
          onPick={(v) => {
            p.props.setStatusFilter(v);
            p.onDone();
          }}
          query={p.valueQuery}
          setQuery={p.setValueQuery}
          searchRef={p.valueSearchRef}
          testidPrefix="filter-value-status"
        />
      </Show>

      <Show when={p.editing === "account"}>
        <SingleSelectList
          options={[
            { value: "", label: "All accounts" },
            ...p.props
              .accounts()
              .map((a) => ({ value: String(a.id), label: a.name })),
          ]}
          selected={p.props.accountFilter}
          onPick={(v) => {
            p.props.setAccountFilter(v);
            p.onDone();
          }}
          query={p.valueQuery}
          setQuery={p.setValueQuery}
          searchRef={p.valueSearchRef}
          testidPrefix="filter-value-account"
        />
      </Show>

      <Show when={p.editing === "category"}>
        <SingleSelectList
          options={p.props.subcategoryOptions().map((name) => {
            const count = p.props.subcategoryCounts()[name] ?? 0;
            return {
              value: name,
              label: count > 0 ? `${name} [${count}]` : name,
            };
          })}
          selected={p.props.subcategoryFilter}
          onPick={(v) => {
            p.props.setSubcategoryFilter(v);
            p.onDone();
          }}
          query={p.valueQuery}
          setQuery={p.setValueQuery}
          searchRef={p.valueSearchRef}
          testidPrefix="filter-value-category"
          allowClear
        />
      </Show>

      <Show when={p.editing === "by"}>
        <SingleSelectList
          options={p.props.creators().map((c) => ({
            value: c.id,
            label: c.count && c.count > 0 ? `${c.name} [${c.count}]` : c.name,
          }))}
          selected={p.props.createdByFilter}
          onPick={(v) => {
            p.props.setCreatedByFilter(v);
            p.onDone();
          }}
          query={p.valueQuery}
          setQuery={p.setValueQuery}
          searchRef={p.valueSearchRef}
          testidPrefix="filter-value-by"
          allowClear
        />
      </Show>
    </>
  );
};

// Multi-select with checkboxes. Used by Type and PDC. Both have small
// option counts so the search box is mostly there for keyboard-first
// flows; it stays useful as the option lists grow.
const MultiSelectList: Component<{
  options: { value: string; label: string; icon?: IconLike; dot?: string }[];
  selected: () => Set<string>;
  onToggle: (v: string) => void;
  query: () => string;
  setQuery: (v: string) => void;
  searchRef: (el: HTMLInputElement) => void;
  testidPrefix: string;
}> = (p) => {
  const filtered = createMemo(() => {
    const q = p.query().trim().toLowerCase();
    if (!q) return p.options;
    return p.options.filter((o) => o.label.toLowerCase().includes(q));
  });
  return (
    <>
      <div class="px-2 py-1.5 border-b border-zinc-800">
        <input
          ref={p.searchRef}
          type="text"
          value={p.query()}
          onInput={(e) => p.setQuery(e.currentTarget.value)}
          placeholder="Search..."
          data-testid={`${p.testidPrefix}-search`}
          class="w-full px-2 py-1 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
        />
      </div>
      <div class="flex-1 overflow-y-auto">
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="px-3 py-3 text-xs text-zinc-500 text-center">
              No matches
            </div>
          }
        >
          <For each={filtered()}>
            {(opt) => {
              const checked = () => p.selected().has(opt.value);
              return (
                <button
                  type="button"
                  // Option values flow through verbatim into the testid.
                  // Multi-select properties (type, pdc) ship hardcoded slugs
                  // so this is always clean. Single-select callers that
                  // pass user-derived values (subcategory names) may produce
                  // testids with spaces or punctuation; getByTestId still
                  // matches them literally, but [data-testid^=...] partial
                  // selectors won't tokenize whitespace.
                  data-testid={`${p.testidPrefix}-${opt.value}`}
                  aria-pressed={checked()}
                  onClick={() => p.onToggle(opt.value)}
                  class="w-full text-left px-3 py-2 text-xs hover:bg-amber-500/10 transition-colors flex items-center gap-2 cursor-pointer"
                  classList={{
                    "text-amber-400": checked(),
                    "text-zinc-200": !checked(),
                  }}
                >
                  <span
                    class="w-4 h-4 rounded border flex items-center justify-center shrink-0"
                    classList={{
                      "border-amber-500/60 bg-amber-500/20": checked(),
                      "border-zinc-700": !checked(),
                    }}
                  >
                    <Show when={checked()}>
                      <Check size={10} class="text-amber-400" />
                    </Show>
                  </span>
                  <Show when={opt.icon}>
                    {(icon) => {
                      const Ico = icon();
                      return <Ico size={12} class="text-zinc-500" />;
                    }}
                  </Show>
                  <Show when={opt.dot}>
                    <span class={`w-1.5 h-1.5 rounded-full ${opt.dot}`} />
                  </Show>
                  <span class="flex-1">{opt.label}</span>
                </button>
              );
            }}
          </For>
        </Show>
      </div>
    </>
  );
};

// Single-select list. Used by Status, Account, Category. `allowClear`
// adds a "Clear selection" footer for properties whose default is the
// empty string (Account, Category) — Status has its own meaningful
// default ("active") so picking "Active" is the clear path.
const SingleSelectList: Component<{
  options: { value: string; label: string }[];
  selected: () => string;
  onPick: (v: string) => void;
  query: () => string;
  setQuery: (v: string) => void;
  searchRef: (el: HTMLInputElement) => void;
  testidPrefix: string;
  allowClear?: boolean;
}> = (p) => {
  const filtered = createMemo(() => {
    const q = p.query().trim().toLowerCase();
    if (!q) return p.options;
    return p.options.filter((o) => o.label.toLowerCase().includes(q));
  });
  return (
    <>
      <div class="px-2 py-1.5 border-b border-zinc-800">
        <input
          ref={p.searchRef}
          type="text"
          value={p.query()}
          onInput={(e) => p.setQuery(e.currentTarget.value)}
          placeholder="Search..."
          data-testid={`${p.testidPrefix}-search`}
          class="w-full px-2 py-1 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
        />
      </div>
      <div class="flex-1 overflow-y-auto">
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="px-3 py-3 text-xs text-zinc-500 text-center">
              No matches
            </div>
          }
        >
          <For each={filtered()}>
            {(opt) => {
              const selected = () => p.selected() === opt.value;
              return (
                <button
                  type="button"
                  data-testid={`${p.testidPrefix}-${opt.value || "empty"}`}
                  aria-pressed={selected()}
                  onClick={() => p.onPick(opt.value)}
                  class="w-full text-left px-3 py-2 text-xs hover:bg-amber-500/10 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                  classList={{
                    "text-amber-400": selected(),
                    "text-zinc-200": !selected(),
                  }}
                >
                  <span class="truncate">{opt.label}</span>
                  <Show when={selected()}>
                    <Check size={12} class="text-amber-400 shrink-0" />
                  </Show>
                </button>
              );
            }}
          </For>
        </Show>
      </div>
      <Show when={p.allowClear && p.selected() !== ""}>
        <div class="border-t border-zinc-800">
          <button
            type="button"
            data-testid={`${p.testidPrefix}-clear`}
            onClick={() => p.onPick("")}
            class="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2 cursor-pointer"
          >
            <X size={12} />
            Clear selection
          </button>
        </div>
      </Show>
    </>
  );
};
