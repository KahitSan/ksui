import { createContext, useContext, type Accessor } from "solid-js";

// A Portal-based popover (DatePicker, ComboBox, ...) must mount as a DOM
// DESCENDANT of an ancestor dialog-variant Modal's <dialog> element, not
// document.body. dialogEl.showModal() marks everything OUTSIDE the dialog's
// flat-tree subtree inert, and inertness is computed on the flat tree —
// independent of the Popover API's top-layer PAINT order (useTopLayer only
// fixes painting). A popover portaled straight to document.body from inside
// an open <dialog> paints above it but is excluded from hit-testing, so real
// clicks never reach it even though it's visibly on top.
//
// Default is `null`: no ancestor dialog (standalone usage), or the sheet
// variant (a plain <div>, no showModal(), so no inertness barrier exists) —
// both mean "mount to document.body", today's behavior.
const ModalLayerContext = createContext<Accessor<HTMLElement | null>>(() => null);

export const ModalLayerProvider = ModalLayerContext.Provider;

/**
 * Mount target for a Portal-based popover: the nearest ancestor dialog's
 * element when rendered inside a dialog-variant Modal, else document.body.
 * Called once per popover-open (the Portal itself only reads `mount` at
 * creation), so a plain `Node` accessor — not a reactive signal — is enough.
 */
export function usePopoverMount(): () => Node {
  const layer = useContext(ModalLayerContext);
  return () => layer() ?? document.body;
}
