// Selector for elements a Tab key would normally land on. Picker dropdowns
// in this app render their popups via Portal outside the modal's subtree,
// so the trap also has to consider those, but options/inputs inside a
// Portal are still owned by the open modal logically. The trap solves this
// by also walking matching descendants of the document body that point back
// to the modal via aria-controls / aria-labelledby. For phase 1, the
// simpler implementation is sufficient: every modal in this app keeps its
// own focusable descendants inside the dialog node itself, and pickers
// close on Escape independently of the trap.
const TABBABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([type="hidden"]):not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function tabbablesIn(root: HTMLElement): HTMLElement[] {
  // Walk the modal's subtree and keep visible, non-disabled focusables.
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter((el) => {
    if (el.hidden) return false;
    // offsetParent is null for `display: none` and detached nodes; visibility
    // hidden elements are excluded too. Don't trust just the selector list.
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
    return true;
  });
}

/**
 * While any modal is open, suppress the browser/PWA pull-to-refresh and
 * overscroll-bounce gestures so a stray drag on the backdrop doesn't reload
 * the page out from under a half-filled form. Counter handles nested modals
 * (e.g. a Confirm dialog opening on top of a transactions sheet).
 *
 * Pair `lockPullToRefresh()` with `unlockPullToRefresh()` (e.g. via Solid
 * `onCleanup`) so each lock has exactly one matching unlock.
 */
let openModalCount = 0;
let prevHtmlOverscroll: string | null = null;
let prevBodyOverscroll: string | null = null;

export function lockPullToRefresh() {
  if (typeof document === "undefined") return;
  if (openModalCount === 0) {
    const html = document.documentElement;
    const body = document.body;
    prevHtmlOverscroll = html.style.overscrollBehavior;
    prevBodyOverscroll = body.style.overscrollBehavior;
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
  }
  openModalCount += 1;
}

export function unlockPullToRefresh() {
  if (typeof document === "undefined") return;
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) {
    document.documentElement.style.overscrollBehavior = prevHtmlOverscroll ?? "";
    document.body.style.overscrollBehavior = prevBodyOverscroll ?? "";
    prevHtmlOverscroll = null;
    prevBodyOverscroll = null;
  }
}

/**
 * Trap Tab and Shift+Tab inside `el` and restore focus on cleanup. Returns
 * a teardown function the caller can use to deactivate the trap explicitly
 * (also runs automatically when called inside a Solid `onCleanup`).
 *
 * Use this from a ref callback or Solid effect:
 *
 *   <div ref={(el) => { onCleanup(useFocusTrap(el)); }}>
 *
 * Or from an effect:
 *
 *   createEffect(() => {
 *     if (containerRef) onCleanup(useFocusTrap(containerRef));
 *   });
 *
 * The trap only intercepts Tab. Escape, click-outside, and submit handling
 * remain the modal's responsibility, the trap is purely a focus-keeper.
 */
export function useFocusTrap(el: HTMLElement | undefined): () => void {
  if (!el) return () => {};

  // Snapshot the element that had focus before the modal mounted so we can
  // hand it back when the trap deactivates. Skip the document body which is
  // a non-actionable default.
  const previouslyFocused =
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const list = tabbablesIn(el);
    if (list.length === 0) {
      // No focusable descendants (an empty modal), pin focus on the
      // container itself rather than letting the browser tab away.
      e.preventDefault();
      el.focus();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inTrap = active && el.contains(active);
    if (e.shiftKey) {
      if (!inTrap || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (!inTrap || active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  // Capture phase so we see the keydown before any descendant handler can
  // swallow it. Solid's <Show>/<Portal> wrapping doesn't change that.
  document.addEventListener("keydown", handleKeyDown, true);

  return () => {
    document.removeEventListener("keydown", handleKeyDown, true);
    // Restore focus only when the snapshot is still in the DOM. If the
    // caller removed the original button between mount and unmount,
    // dropping focus on a detached element would just clear it instead.
    if (previouslyFocused && document.contains(previouslyFocused)) {
      try {
        previouslyFocused.focus();
      } catch {
        /* element became unfocusable in the meantime, let the browser pick */
      }
    }
  };
}

/**
 * Ref callback that moves focus into a freshly mounted container so keyboard
 * users land somewhere meaningful. Used on modal content containers:
 * `ref={autoFocusOnMount}`.
 *
 * Lookup order:
 *   1. An explicit `[data-autofocus]` element (or its first focusable
 *      descendant). Lets a parent override the default heuristic when the
 *      first visible input is not the right place to land, e.g. a modal
 *      whose primary affordance is a search/picker rather than a date field.
 *   2. The first text-entry control (input/textarea/select). Most modals open
 *      onto a form, and dropping focus directly into the first field is what
 *      sighted keyboard users expect.
 *   3. Any other focusable element (button, link, anything with `tabindex`).
 *      A modal that opens onto an action grid (e.g. the Counter cart) has no
 *      inputs on first render; without this fallback `el.focus()` would never
 *      run and focus would stay on the button that opened the modal.
 */
export function autoFocusOnMount(el: HTMLElement | undefined) {
  if (!el) return;
  queueMicrotask(() => {
    const focusableSelector =
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const inputSelector =
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])';

    const marker = el.querySelector<HTMLElement>("[data-autofocus]");
    if (marker) {
      // The marker itself may be focusable; prefer it. Otherwise pick the
      // first focusable descendant (e.g. the trigger button inside a custom
      // picker component).
      if (marker.matches(focusableSelector)) {
        marker.focus();
        return;
      }
      const inner = marker.querySelector<HTMLElement>(focusableSelector);
      if (inner) {
        inner.focus();
        return;
      }
    }

    const input = el.querySelector<HTMLElement>(inputSelector);
    if (input) {
      input.focus();
      return;
    }
    // Fall back to the first interactive element. tabindex="-1" is excluded
    // so a programmatically-focusable container does not steal focus from a
    // child the user can actually act on.
    const focusable = el.querySelector<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  });
}
