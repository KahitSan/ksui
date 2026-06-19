// Self-contained modal dialog. Promoted into ksui from the former host kit so
// the library no longer depends on "@kserp/host-ui": ImageCropper (the only
// in-library consumer) now imports Modal from here.
//
// Like Button/ProgressBar, ksui publishes no sidecar .css — the styles are
// injected once per page via a runtime <style> tag and referenced with plain,
// unscoped `ksui-modal-*` class names, so the component carries no Tailwind or
// host-brand-class dependency. Surface/border colors read from CSS custom
// properties (`--ksui-modal-bg`, `--ksui-modal-border`) with dark-friendly
// fallbacks, so a consumer can retint without forking the component.
//
// Lifecycle matches the original: mount === open, unmount === closed (wrap in
// `<Show when={…}>`). The default variant uses the native <dialog> element
// (top-layer rendering, native ::backdrop, browser Escape + focus trap); the
// sheet variant uses a <div> overlay so child popovers Portaled into
// document.body still compose above the backdrop via z-index.

import { JSX, onCleanup, onMount, splitProps } from "solid-js";
import { autoFocusOnMount, lockPullToRefresh, unlockPullToRefresh, useFocusTrap } from "../../utils/dom";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "5xl" | "7xl";
export type ModalTone = "default" | "danger";

const SIZE_MAX_WIDTH: Record<ModalSize, string> = {
  sm: "24rem",
  md: "28rem",
  lg: "32rem",
  xl: "36rem",
  "2xl": "42rem",
  "3xl": "48rem",
  "5xl": "64rem",
  "7xl": "80rem",
};

const STYLE_ID = "ksui-modal-style";

function ensureModalStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.ksui-modal-dialog{position:fixed;inset:0;z-index:50;background:transparent;padding:0;margin:0;max-width:none;max-height:none;width:100vw;height:100vh;border:0;}
.ksui-modal-dialog[open]{display:flex;align-items:center;justify-content:center;padding:1rem;}
.ksui-modal-dialog::backdrop{background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);}
.ksui-modal-sheet-overlay{position:fixed;inset:0;z-index:50;display:flex;align-items:flex-end;justify-content:center;}
@media (min-width:640px){.ksui-modal-sheet-overlay{align-items:center;padding:1rem;}}
.ksui-modal-sheet-backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);}
.ksui-modal-card{position:relative;z-index:10;width:100%;background:var(--ksui-modal-bg,#18181b);color:var(--ksui-modal-fg,inherit);border:1px solid var(--ksui-modal-border,rgba(245,158,11,0.3));border-radius:0.75rem;padding:1.5rem;box-shadow:0 25px 50px -12px rgba(0,0,0,0.6);max-height:90vh;overflow-x:hidden;overflow-y:auto;}
.ksui-modal-card.danger{border-color:var(--ksui-modal-border-danger,rgba(239,68,68,0.3));}
.ksui-modal-sheet-card{position:relative;z-index:10;width:100%;background:var(--ksui-modal-bg,#18181b);color:var(--ksui-modal-fg,inherit);border:1px solid var(--ksui-modal-border,rgba(245,158,11,0.3));box-shadow:0 25px 50px -12px rgba(0,0,0,0.6);max-height:92vh;overflow:hidden;overscroll-behavior:contain;}
.ksui-modal-sheet-card.danger{border-color:var(--ksui-modal-border-danger,rgba(239,68,68,0.3));}
@media (min-width:640px){.ksui-modal-sheet-card{width:auto;border-radius:0.75rem;max-height:88vh;}}
`;
  document.head.appendChild(style);
}

export interface ModalProps {
  /** Fired on Escape, backdrop click, or any other dismissal trigger. */
  onClose: () => void;
  /** When false, Escape and backdrop clicks are ignored. Defaults to true. */
  dismissable?: boolean;
  /** "default" is a centered native-<dialog> card; "sheet" is a bottom-sheet <div> overlay. */
  variant?: "default" | "sheet";
  /** Outer card max width. Defaults to "lg" (default variant) / "3xl" (sheet). */
  size?: ModalSize;
  /** Border tint. "danger" for destructive confirms. Defaults to "default". */
  tone?: ModalTone;
  /** Optional accessible name for the dialog. */
  ariaLabel?: string;
  children: JSX.Element;
}

type LocalProps = Omit<ModalProps, "variant">;

export function Modal(props: ModalProps): JSX.Element {
  ensureModalStyle();
  const [local] = splitProps(props, [
    "onClose",
    "dismissable",
    "size",
    "tone",
    "ariaLabel",
    "children",
  ]);
  // Variant is read once at mount; call sites pick it statically.
  if (props.variant === "sheet") return SheetModal(local, props.size);
  return DialogModal(local);
}

function DialogModal(local: LocalProps): JSX.Element {
  let dialogEl: HTMLDialogElement | undefined;

  lockPullToRefresh();
  onCleanup(unlockPullToRefresh);

  onMount(() => {
    if (!dialogEl) return;
    if (!dialogEl.open) {
      try {
        dialogEl.showModal();
      } catch {
        // showModal throws if already open or detached; harmless to ignore.
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
            // detached, or showModal disallowed; skip it.
          }
        }
      }
    });
  });

  const handleCancel = (e: Event) => {
    e.preventDefault();
    if (local.dismissable === false) return;
    local.onClose();
  };
  const handleBackdropClick = (e: MouseEvent) => {
    if (local.dismissable === false) return;
    if (e.target === dialogEl) local.onClose();
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialogEl}
      aria-modal="true"
      aria-label={local.ariaLabel}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      class="ksui-modal-dialog"
    >
      <div
        ref={(el) => {
          autoFocusOnMount(el);
          onCleanup(useFocusTrap(el));
        }}
        class={`ksui-modal-card${local.tone === "danger" ? " danger" : ""}`}
        style={{ "max-width": SIZE_MAX_WIDTH[local.size ?? "lg"] }}
      >
        {local.children}
      </div>
    </dialog>
  );
}

function SheetModal(local: LocalProps, size?: ModalSize): JSX.Element {
  lockPullToRefresh();
  onCleanup(unlockPullToRefresh);

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
    <div class="ksui-modal-sheet-overlay">
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div class="ksui-modal-sheet-backdrop" onClick={handleBackdropClick} />
      <div
        ref={(el) => {
          autoFocusOnMount(el);
          onCleanup(useFocusTrap(el));
        }}
        role="dialog"
        aria-modal="true"
        aria-label={local.ariaLabel}
        class={`ksui-modal-sheet-card${local.tone === "danger" ? " danger" : ""}`}
        style={{ "max-width": SIZE_MAX_WIDTH[size ?? "3xl"] }}
      >
        {local.children}
      </div>
    </div>
  );
}

export default Modal;
