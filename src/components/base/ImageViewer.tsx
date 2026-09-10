// Fullscreen image lightbox (Facebook-style): the image centered on a near-opaque
// backdrop, dismissed by the X button, a backdrop click, or Escape. Built on the
// native <dialog> (showModal) for top-layer rendering + native Escape + focus
// containment — the same approach as Modal — but full-bleed with no card chrome,
// so the image fills the viewport.
//
// Why this exists: assets are now served as same-origin object URLs (blob:), which
// are revoked when their owning component unmounts — so opening one in a new tab
// (target="_blank") breaks the moment the source view closes. An in-page viewer
// renders the blob while it's still alive.
//
// Like the rest of ksui, no sidecar CSS: styles inject once via a runtime <style>
// with unscoped `ksui-imgviewer-*` class names. Mount === open, unmount === closed
// (wrap in `<Show when={…}>`).

import { createSignal, onCleanup, onMount } from "solid-js";
import X from "lucide-solid/icons/x";
import { lockPullToRefresh, unlockPullToRefresh } from "../../utils/dom";
import { injectCSS } from "../../utils/inject-css";

const STYLE_ID = "ksui-image-viewer-style";
// The backdrop scrim maps to --ks-overlay (§6a); the img/close-button chrome
// stays a fixed dark treatment since it sits on top of the photo itself, not
// a themeable app surface.
const STYLE_CSS = `
.ksui-imgviewer{position:fixed;inset:0;z-index:60;background:transparent;padding:0;margin:0;max-width:none;max-height:none;width:100vw;height:100vh;border:0;}
.ksui-imgviewer[open]{display:flex;align-items:center;justify-content:center;}
.ksui-imgviewer::backdrop{background:var(--ks-overlay, rgba(0,0,0,0.7));backdrop-filter:blur(2px);}
.ksui-imgviewer-frame{display:grid;place-items:center;width:96vw;height:96vh;}
.ksui-imgviewer-img{display:block;max-width:100%;max-height:100%;object-fit:contain;border-radius:0.25rem;box-shadow:0 25px 50px -12px color-mix(in srgb,var(--ks-overlay,rgba(0,0,0,0.7)) 80%,transparent);}
.ksui-imgviewer-close{position:absolute;top:1rem;right:1rem;display:flex;width:2.5rem;height:2.5rem;align-items:center;justify-content:center;border-radius:9999px;background:color-mix(in srgb,var(--ks-fg,#ffffff) 12%,transparent);color:var(--ks-fg,#ffffff);border:0;cursor:pointer;}
.ksui-imgviewer-close:hover{background:color-mix(in srgb,var(--ks-fg,#ffffff) 22%,transparent);}
`;

interface Props {
  /** Image URL to display (typically a blob: object URL or a public link). */
  src: string;
  /** Accessible name + img alt. */
  alt?: string;
  /** Fired on the X button, a backdrop click, or Escape. */
  onClose: () => void;
}

export default function ImageViewer(props: Props) {
  injectCSS(STYLE_ID, STYLE_CSS);
  let dialogEl: HTMLDialogElement | undefined;
  const [loaded, setLoaded] = createSignal(false);

  lockPullToRefresh();
  onCleanup(unlockPullToRefresh);

  onMount(() => {
    if (dialogEl && !dialogEl.open) {
      try {
        dialogEl.showModal();
      } catch {
        // showModal throws if already open or detached; harmless to ignore.
      }
    }
  });
  onCleanup(() => {
    if (dialogEl?.open) dialogEl.close();
  });

  // Escape fires the dialog's native `cancel`; intercept it to route through onClose.
  const handleCancel = (e: Event) => {
    e.preventDefault();
    props.onClose();
  };
  // A click whose target IS the dialog landed on the backdrop (the image + button
  // are inner elements and stop here), so close.
  const handleClick = (e: MouseEvent) => {
    if (e.target === dialogEl) props.onClose();
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialogEl}
      aria-modal="true"
      aria-label={props.alt || "Image viewer"}
      onCancel={handleCancel}
      onClick={handleClick}
      class="ksui-imgviewer"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={props.onClose}
        class="ksui-imgviewer-close"
      >
        <X size={22} />
      </button>
      <div class="ksui-imgviewer-frame" aria-busy={!loaded()}>
        <img
          src={props.src}
          alt={props.alt || ""}
          class="ksui-imgviewer-img"
          style={{ opacity: loaded() ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
        />
      </div>
    </dialog>
  );
}
