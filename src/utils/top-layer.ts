import { onMount } from "solid-js";
import { injectCSS } from "./inject-css";

const STYLE_ID = "ksui-toplayer-style";
// UA is the lowest cascade priority, so any author rule (background, border,
// padding, width, sizing, ...) already beats [popover]'s UA defaults without
// help — resetting those was the bug (this stylesheet injects AFTER each
// component's own CSS, so a same-specificity reset would win by source order
// and strip the component's real chrome). Only inset and margin are genuine
// POSITIONING conflicts: UA's inset:0 leaves right/bottom pinned to 0 even
// after a component's inline `top`/`left` override the top/left portion, and
// UA's margin:auto re-centers inside that box — both fight the fixed
// coordinates each popup computes itself.
const STYLE_CSS = `
[data-ksui-toplayer]{inset:auto;margin:0;}
`;

/**
 * Promotes `el` into the browser's top layer via the Popover API so it
 * paints above a native <dialog> (Modal's default variant) regardless of
 * z-index — an ordinary element can never out-paint a top-layer one.
 * `"manual"` disables the API's own light-dismiss/Escape handling; every
 * ksui popup keeps its own mousedown/Escape listeners unchanged.
 *
 * Call from the portaled panel's ref, mirroring useFocusTrap's shape:
 *   ref={(el) => { popupRef = el; onCleanup(useTopLayer(el)); }}
 *
 * showPopover() is deferred to onMount, not called inline here: this
 * function runs synchronously inside <Portal>'s ref callback, which fires
 * while the node is still detached (Portal appends its container to
 * document.body *after* building the subtree) — el.isConnected is false
 * and el.ownerDocument !== document at that point, so an inline call
 * always throws InvalidStateError. onMount queues onto Solid's render-effect
 * list, which only flushes once the whole synchronous render pass —
 * including Portal's appendChild — has finished, so by the time it runs
 * the node is guaranteed connected. (Same fix shape as Modal's DialogModal,
 * which calls showModal() in onMount rather than in dialogEl's ref.)
 */
export function useTopLayer(el: HTMLElement | undefined): () => void {
  if (!el) return () => {};
  injectCSS(STYLE_ID, STYLE_CSS);
  el.setAttribute("popover", "manual");
  el.setAttribute("data-ksui-toplayer", "");
  onMount(() => {
    // No Popover API (e.g. jsdom in unit tests) — nothing to promote, not an error.
    if (typeof el.showPopover !== "function") return;
    try {
      el.showPopover();
    } catch (err) {
      // showPopover() throws if already open (rapid re-open); that's the only
      // benign case left once we're guaranteed connected, and it's detectable
      // because the element really is :popover-open despite the throw. Any
      // other failure is real and must surface, not vanish into a no-op.
      if (!el.matches(":popover-open")) {
        console.error("[ksui] useTopLayer: showPopover() failed to promote element", err);
      }
    }
  });
  return () => {
    try {
      el.hidePopover();
    } catch {
      // already hidden, disconnected first, or API unavailable — harmless.
    }
  };
}
