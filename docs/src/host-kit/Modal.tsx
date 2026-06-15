import { JSX, onCleanup, onMount, splitProps } from "solid-js";
import { autoFocusOnMount, lockPullToRefresh, unlockPullToRefresh, useFocusTrap } from "./dom";

/**
 * Shared modal component. Replaces the seven inline `ModalOverlay`
 * definitions that lived in route files (clients, payees, workspaces,
 * financial-accounts, subscriptions, vouchers, transactions). Same look,
 * same lifecycle (mount = open, unmount = closed, drop a
 * `<Show when={…}>` around it like the inline versions did), with three
 * concrete improvements:
 *
 *  1. Escape closes the modal automatically. Default variant uses the
 *     browser's native `<dialog>` element so the OS surfaces the cancel
 *     event for free; the sheet variant intercepts a window keydown.
 *     Either way the parent's `<Show>` predicate gets toggled by the
 *     Modal, no per-route ad-hoc handlers needed.
 *  2. Focus is trapped inside the modal while it's open via the existing
 *     `useFocusTrap` helper, plus the browser's own focus model when the
 *     native `<dialog>` is in the top layer.
 *  3. `role="dialog" aria-modal="true"` and the focus-restore-on-unmount
 *     bits are now consistent across every modal in the app instead of
 *     two of seven sites doing it.
 *
 * ## Default vs sheet variant
 *
 * "default" uses the browser's native `<dialog>` element (showModal()).
 * That gives top-layer rendering, native ::backdrop, and the browser's
 * own focus trap. Used by clients/payees/orgs/FA/vouchers/subscriptions.
 *
 * "sheet" uses a plain `<div>` overlay (mobile-friendly bottom-sheet
 * styling). It deliberately does NOT use the native `<dialog>` element
 * because the transactions modal nests children that mount popovers via
 * `<Portal>` into `document.body`. A native `<dialog>` is rendered in
 * the top layer, which is rendered above all z-index, including the
 * Portal-mounted popovers. The result would be that picker popups
 * (PayeePicker, AttachmentPicker, AccountPicker) appear to vanish behind
 * the modal backdrop. Until those pickers move their popups inside the
 * dialog subtree (which is a much larger refactor), the sheet variant
 * keeps the previous z-index-based composition working.
 *
 * Backdrop click closes the modal in both variants. For the default
 * variant the click target is the `<dialog>` element itself (the area
 * outside the inner content card). For the sheet variant we layer an
 * absolutely-positioned backdrop `<div>` underneath and bind onClick to
 * it directly.
 */
/**
 * Modal width tokens. The outer card carries `w-full max-w-<size>` so the
 * box claims a fixed width regardless of how much content sits inside,
 * so a short detail view doesn't shrink the modal to text-width. Sizes are
 * statically listed (not interpolated) so Tailwind's JIT picks them up.
 */
export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "5xl" | "7xl";

const MODAL_SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "5xl": "max-w-5xl",
  "7xl": "max-w-7xl",
};

const SHEET_SIZE_CLASS: Record<ModalSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
  "3xl": "sm:max-w-3xl",
  "5xl": "sm:max-w-5xl",
  "7xl": "sm:max-w-7xl",
};

/**
 * Tone tints the outer border so destructive dialogs read at a glance.
 * "default" is the standard amber/30, "danger" swaps to red/30, matches the
 * hand-rolled delete-user shell in `src/routes/users.tsx`. Pick "danger" when
 * the dialog's primary action erases or archives data.
 */
export type ModalTone = "default" | "danger";

const TONE_BORDER_CLASS: Record<ModalTone, string> = {
  default: "border-amber-500/30",
  danger: "border-red-500/30",
};

export interface ModalProps {
  /** Fired on Escape, backdrop click, or any other dismissal trigger. */
  onClose: () => void;
  /**
   * When false, Escape and backdrop clicks are ignored. Useful for
   * modals that are mid-save and should not be dismissed accidentally.
   * Defaults to true.
   */
  dismissable?: boolean;
  /**
   * Visual variant. "default" matches the centered card used by most
   * routes. "sheet" matches the transactions modal that slides up from
   * the bottom on phones (and keeps the legacy <div> overlay so its
   * Portal-mounted child popovers still compose correctly).
   */
  variant?: "default" | "sheet";
  /**
   * Outer card width. Pins `w-full max-w-<size>` on the card itself so the
   * width is stable regardless of content. Defaults to "lg" for the default
   * variant and "3xl" for the sheet variant.
   */
  size?: ModalSize;
  /** Border tint. "danger" for destructive confirms. Defaults to "default". */
  tone?: ModalTone;
  /** Optional accessible name for the dialog. */
  ariaLabel?: string;
  children: JSX.Element;
}

export function Modal(props: ModalProps) {
  const [local] = splitProps(props, [
    "onClose",
    "dismissable",
    "variant",
    "size",
    "tone",
    "ariaLabel",
    "children",
  ]);

  // Variant is read once at mount, call sites pick a variant statically and
  // don't toggle it. Using `props.variant` directly here is intentional; we
  // don't want to wrap the entire modal in a reactive switch.
  if (local.variant === "sheet") {
    return SheetModal(local);
  }
  return DialogModal(local);
}

/**
 * Default variant, native `<dialog>`. Browser handles Escape, top-layer
 * rendering, and native focus trap when `showModal()` is active.
 */
function DialogModal(local: {
  onClose: () => void;
  dismissable?: boolean;
  size?: ModalSize;
  tone?: ModalTone;
  ariaLabel?: string;
  children: JSX.Element;
}) {
  let dialogEl: HTMLDialogElement | undefined;

  lockPullToRefresh();
  onCleanup(unlockPullToRefresh);

  // Open as soon as we mount. Callers wrap us in a `<Show when={…}>` so
  // mount === should-be-open. showModal() gives us top-layer rendering,
  // the ::backdrop pseudo-element, and the browser's native focus trap +
  // Escape handling.
  onMount(() => {
    if (!dialogEl) return;
    if (!dialogEl.open) {
      try {
        dialogEl.showModal();
      } catch {
        // showModal throws if already open or detached. Either case is
        // harmless to ignore.
      }
    }
  });

  onCleanup(() => {
    if (dialogEl?.open) dialogEl.close();
    queueMicrotask(() => {
      for (const el of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) {
        if (el !== dialogEl && el.isConnected && !el.matches(":modal")) {
          try {
            el.close();
            el.showModal();
          } catch {
            // detached, or showModal disallowed, nothing we can do, skip it
          }
        }
      }
    });
  });

  // The native `cancel` event fires for Escape. Always preventDefault so
  // the dialog's `open` state stays in our control, the parent's `<Show>`
  // is the source of truth, and we want it to drive the close.
  const handleCancel = (e: Event) => {
    e.preventDefault();
    if (local.dismissable === false) return;
    local.onClose();
  };

  // Click outside the inner content card (i.e. on the dialog element
  // itself, which is the backdrop area) closes the modal.
  const handleBackdropClick = (e: MouseEvent) => {
    if (local.dismissable === false) return;
    if (e.target === dialogEl) {
      local.onClose();
    }
  };

  return (
    // The native <dialog> element already exposes role="dialog" implicitly,
    // and Escape/keyboard close is handled by the browser via the `cancel`
    // event (see handleCancel above). The onClick here is solely for the
    // backdrop-click dismiss behavior, which has no keyboard equivalent
    // because Escape already covers that path.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialogEl}
      aria-modal="true"
      aria-label={local.ariaLabel}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      // `fixed inset-0 z-50`: a modal dialog renders in the top layer (above
      // everything) so z-index is moot while it IS `:modal`. But a nested modal
      // closing can briefly leave this dialog `open` yet non-modal (it falls out
      // of the top layer during a parent re-render); without an explicit
      // stacking context it then renders UNDER the sticky page header (z-30) /
      // sidebar (z-40), which intercept clicks on its top-edge controls. Pinning
      // it to a fixed, above-chrome layer keeps its content clickable through
      // that window too.
      class="ks-modal ks-modal-default fixed inset-0 z-50 bg-transparent p-0 m-0 max-w-none max-h-none w-screen h-screen open:flex items-center justify-center p-4 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <div
        ref={(el) => {
          autoFocusOnMount(el);
          onCleanup(useFocusTrap(el));
        }}
        class={`relative z-10 w-full ${MODAL_SIZE_CLASS[local.size ?? "lg"]} card-bg rounded-xl border ${TONE_BORDER_CLASS[local.tone ?? "default"]} p-6 shadow-2xl max-h-[90vh] overflow-x-hidden overflow-y-auto`}
      >
        {local.children}
      </div>
    </dialog>
  );
}

/**
 * Sheet variant, `<div>` overlay so child popovers rendered via
 * `<Portal>` into `document.body` (PayeePicker, AttachmentPicker,
 * AccountPicker, etc. on the transactions create modal) still float
 * above the modal backdrop via z-index. We get role/aria-modal,
 * useFocusTrap, autoFocusOnMount, and a manual Escape handler, same
 * surface area as the previous inline implementation, just hoisted.
 */
function SheetModal(local: {
  onClose: () => void;
  dismissable?: boolean;
  size?: ModalSize;
  tone?: ModalTone;
  ariaLabel?: string;
  children: JSX.Element;
}) {
  lockPullToRefresh();
  onCleanup(unlockPullToRefresh);

  // Manual Escape handler, equivalent to what the native <dialog>
  // gives us for free in the default variant.
  const handleKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (local.dismissable === false) return;
    local.onClose();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  }

  const handleBackdropClick = () => {
    if (local.dismissable === false) return;
    local.onClose();
  };

  return (
    <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 lg:p-6">
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div class="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={handleBackdropClick} />
      <div
        ref={(el) => {
          autoFocusOnMount(el);
          onCleanup(useFocusTrap(el));
        }}
        role="dialog"
        aria-modal="true"
        aria-label={local.ariaLabel}
        class={`relative z-10 w-full sm:w-auto ${local.size ? SHEET_SIZE_CLASS[local.size] : "sm:max-w-3xl"} card-bg sm:rounded-xl border ${TONE_BORDER_CLASS[local.tone ?? "default"]} shadow-2xl max-h-[92vh] sm:max-h-[88vh] overflow-hidden overscroll-contain`}
      >
        {local.children}
      </div>
    </div>
  );
}

export default Modal;
