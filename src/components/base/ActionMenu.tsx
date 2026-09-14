import { For, Show, createSignal, createUniqueId, onCleanup, onMount, type Component, type JSX } from "solid-js";
import { Dynamic, Portal } from "solid-js/web";
import MoreHorizontal from "lucide-solid/icons/more-horizontal";
import { injectCSS } from "../../utils/inject-css";
import { usePopoverMount } from "../../utils/modal-layer";
import { useTopLayer } from "../../utils/top-layer";

const STYLE_ID = "ksui-action-menu-style";
const STYLE_CSS = `
.ksui-action-menu{position:relative;display:inline-block;}
.ksui-action-menu__trigger{display:inline-flex;width:2rem;height:2rem;align-items:center;justify-content:center;border:0;border-radius:.375rem;background:transparent;color:var(--ksui-action-menu-muted,var(--ks-fg-muted,#a1a1aa));cursor:pointer;transition:background-color .15s ease,color .15s ease;}
.ksui-action-menu__trigger:hover,.ksui-action-menu__trigger[aria-expanded="true"]{background:var(--ksui-action-menu-hover,var(--ks-surface-raised,#1a1a1a));color:var(--ksui-action-menu-fg,var(--ks-fg,#ffffff));}
.ksui-action-menu__trigger:focus-visible,.ksui-action-menu__item:focus-visible{outline:2px solid var(--ksui-action-menu-focus,var(--ks-focus-ring,#c9a961));outline-offset:2px;}
.ksui-action-menu__panel{position:fixed;z-index:70;min-width:11rem;overflow:hidden;border:1px solid var(--ksui-action-menu-border,var(--ks-border,rgba(39,39,42,0.5)));border-radius:.5rem;background:var(--ksui-action-menu-bg,var(--ks-surface,#0f0f0f));padding:.25rem 0;box-shadow:var(--ksui-action-menu-shadow,var(--ks-shadow-lg,0 12px 32px rgba(0,0,0,0.6)));}
.ksui-action-menu__item{display:flex;width:100%;align-items:center;gap:.5rem;border:0;background:transparent;padding:.375rem .75rem;color:var(--ksui-action-menu-fg,var(--ks-fg,#ffffff));font:inherit;font-size:.875rem;line-height:1.25rem;text-align:left;cursor:pointer;transition:background-color .15s ease,color .15s ease;}
.ksui-action-menu__item:hover,.ksui-action-menu__item:focus{background:var(--ksui-action-menu-hover,var(--ks-surface-raised,#1a1a1a));outline:none;}
.ksui-action-menu__item--danger{color:var(--ksui-action-menu-danger,var(--ks-danger,#ef4444));}
.ksui-action-menu__item--danger:hover,.ksui-action-menu__item--danger:focus{background:var(--ksui-action-menu-danger-bg,color-mix(in srgb,var(--ks-danger,#ef4444) 10%,transparent));}
.ksui-action-menu__item:disabled{cursor:not-allowed;opacity:.5;}
.ksui-action-menu__item-icon{display:inline-flex;flex:none;}
.ksui-action-menu__separator{margin:.25rem 0;border-top:1px solid var(--ksui-action-menu-border,var(--ks-border,rgba(39,39,42,0.5)));}
`;

export type ActionMenuIcon = Component<{ size?: number; class?: string }>;
export interface ActionMenuItem {
  id: string;
  label: string;
  icon?: ActionMenuIcon;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}
export interface ActionMenuProps {
  label: string;
  items: readonly ActionMenuItem[];
  onSelect: (id: string) => void;
  icon?: ActionMenuIcon;
  align?: "start" | "end";
  class?: string;
  triggerClass?: string;
  menuClass?: string;
  testId?: string;
}

function nextMenuItemIndex(key: string, current: number, length: number): number | undefined {
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % length;
    case "ArrowUp":
      return current < 0 ? length - 1 : (current - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return undefined;
  }
}

export default function ActionMenu(props: ActionMenuProps): JSX.Element {
  injectCSS(STYLE_ID, STYLE_CSS);
  const mount = usePopoverMount();
  const menuId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal({ top: 0, left: 0 });
  let container: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;
  const TriggerIcon = () => props.icon ?? MoreHorizontal;
  const enabledItems = () => [...(menu?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [])];
  const focusItem = (edge: "first" | "last") => queueMicrotask(() => {
    const items = enabledItems();
    (edge === "first" ? items[0] : items[items.length - 1])?.focus();
  });
  const updatePosition = () => {
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = menu?.offsetWidth || 176;
    const height = menu?.offsetHeight || 0;
    const left = props.align === "start" ? rect.left : rect.right - width;
    const top = height > 0 && rect.bottom + 4 + height > window.innerHeight
      ? Math.max(8, rect.top - height - 4)
      : rect.bottom + 4;
    setPosition({ top, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
  };
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => trigger?.focus());
  };
  const openMenu = (edge: "first" | "last" = "first") => {
    setOpen(true);
    queueMicrotask(() => {
      updatePosition();
      focusItem(edge);
    });
  };
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (!open() || event.key !== "Escape") return;
    event.preventDefault();
    close(true);
  };
  const onDocumentPointerDown = (event: MouseEvent) => {
    const target = event.target as Node;
    if (container?.contains(target) || menu?.contains(target)) return;
    close();
  };
  const onMenuKeyDown = (event: KeyboardEvent) => {
    const items = enabledItems();
    if (event.key === "Tab") {
      close();
      return;
    }
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = nextMenuItemIndex(event.key, current, items.length);
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  };
  onMount(() => {
    document.addEventListener("keydown", onDocumentKeyDown);
    document.addEventListener("mousedown", onDocumentPointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
  });
  onCleanup(() => {
    document.removeEventListener("keydown", onDocumentKeyDown);
    document.removeEventListener("mousedown", onDocumentPointerDown);
    window.removeEventListener("resize", updatePosition);
    window.removeEventListener("scroll", updatePosition, true);
  });
  return (
    <div ref={container} class={`ksui-action-menu ${props.class ?? ""}`}>
      <button
        ref={trigger}
        type="button"
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-controls={open() ? menuId : undefined}
        data-testid={props.testId}
        class={`ksui-action-menu__trigger ${props.triggerClass ?? ""}`}
        onClick={() => open() ? close() : openMenu()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(event.key === "ArrowUp" ? "last" : "first");
          }
        }}
      >
        <Dynamic component={TriggerIcon()} size={16} aria-hidden="true" />
      </button>
      <Show when={open()}>
        <Portal mount={mount()}>
          <div
            ref={(element) => {
              menu = element;
              onCleanup(useTopLayer(element));
              queueMicrotask(updatePosition);
            }}
            id={menuId}
            role="menu"
            aria-label={props.label}
            class={`ksui-action-menu__panel ${props.menuClass ?? ""}`}
            style={{ top: `${position().top}px`, left: `${position().left}px` }}
            onKeyDown={onMenuKeyDown}
          >
            <For each={props.items}>{(item) => (
              <>
                <Show when={item.separatorBefore}><div role="separator" class="ksui-action-menu__separator" /></Show>
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  class={`ksui-action-menu__item${item.danger ? " ksui-action-menu__item--danger" : ""}`}
                  onClick={() => {
                    if (item.disabled) return;
                    close();
                    props.onSelect(item.id);
                  }}
                >
                  <Show when={item.icon}>{(Icon) => <span class="ksui-action-menu__item-icon"><Dynamic component={Icon()} size={14} aria-hidden="true" /></span>}</Show>
                  {item.label}
                </button>
              </>
            )}</For>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

export const RowMenu = ActionMenu;
export type RowMenuItem = ActionMenuItem;
export type RowMenuProps = ActionMenuProps;
