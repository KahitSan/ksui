import { createUniqueId, type JSX } from "solid-js";

interface TooltipProps {
  /** Text or JSX to show inside the tooltip bubble. */
  content: JSX.Element;
  /** Where the bubble sits relative to the trigger. Default "top". */
  placement?: "top" | "bottom";
  /** Allow the trigger to be any element; the wrapper is a span. */
  children: JSX.Element;
  /** Extra classes on the wrapper. The wrapper is inline-flex so it sits
   *  cleanly inside flex rows next to the trigger element. */
  class?: string;
  /** Optional explicit id for the tooltip element. Auto-generated via
   *  `createUniqueId()` when omitted. Callers can pass this id forward
   *  as `aria-describedby` on a deeper focusable trigger when the wrapper
   *  span isn't the focusable surface — the W3C tooltip pattern wants
   *  describedby on the trigger itself, not on an ancestor. The wrapper
   *  also carries the same describedby so SRs that read by element type
   *  surface the description on the way through. */
  id?: string;
}

// Lightweight hover/focus tooltip. CSS-only — no JS positioning, no portal.
// Anchors to the trigger via group-hover and stays out of layout (absolute).
// For dense / clipped containers, prefer a portal-based picker instead; this
// is for short copy on buttons and chips ("Mark as payer", "Removes
// selections; nothing else is lost", etc.) that needs to read more clearly
// than the native `title=` attribute.
//
// A11y notes:
//   - The bubble carries `role="tooltip"` and a stable id, so assistive
//     tech can find it via the AT tree. We removed an earlier `aria-hidden`
//     because it actively contradicted the role: ATs saw "tooltip" and
//     then "skip me", which left screen-reader users with a tooltip
//     advertised but unreadable.
//   - The wrapper carries `aria-describedby={tooltipId}` so navigating
//     into the wrapper surfaces the description. The W3C tooltip pattern
//     prefers describedby on the focusable trigger itself; since the
//     trigger is `props.children` (any element) and Solid has no
//     cloneElement, the trigger-level wiring lives with the caller in
//     specific cases that need it. See #627 for the broader sweep that
//     introduces a directive-based wiring API.
export default function Tooltip(props: TooltipProps): JSX.Element {
  const tooltipId = props.id ?? createUniqueId();
  const placement = () => props.placement ?? "top";
  return (
    <span
      class={`relative inline-flex group/tt ${props.class ?? ""}`}
      data-tooltip-wrap
      aria-describedby={tooltipId}
    >
      {props.children}
      <span
        role="tooltip"
        id={tooltipId}
        class={`pointer-events-none absolute left-1/2 -translate-x-1/2 px-2 py-1 rounded-md bg-zinc-900 border border-zinc-700/80 text-[11px] text-zinc-100 whitespace-nowrap opacity-0 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100 transition-opacity duration-150 delay-150 z-50 shadow-lg ${
          placement() === "bottom" ? "top-full mt-1" : "bottom-full mb-1"
        }`}
      >
        {props.content}
      </span>
    </span>
  );
}
