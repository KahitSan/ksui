// U7 — flow node model (Vision §9). The CLIENT renders only UI-EFFECT nodes;
// ALL authority/data/branching lives server-side. The client never decides the
// graph — it renders the current node and POSTs each step to a host-injected
// `advance(state, input) => Promise<nextNode>` resolver. ksui ships NO server
// logic and NO `command`/`call(peer)` node kinds: those carry authority and run
// on the kernel (§9 "authority is server-side, presentation is client-side").
//
// This file is PURE (no solid-js, no component imports) so the node model + its
// type guards unit-test under plain node, mirroring the resource `spec.ts` split.

/** A single field a flow `form` node asks the user to fill (§10, UI subset). */
export interface FlowFormField {
  readonly key: string;
  readonly label: string;
  /** Widget hint the runner maps to an input; defaults to "text". */
  readonly type?: "text" | "textarea" | "number" | "select" | "toggle";
  readonly required?: boolean;
  readonly placeholder?: string;
  /** For "select": the choices. */
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>;
}

/** A choice the user picks; its `value` is the input POSTed to `advance` (§9). */
export interface FlowChoiceOption {
  readonly value: string;
  readonly label: string;
  /** Visual emphasis hint; the runner styles primary distinctly. */
  readonly intent?: "primary" | "neutral" | "danger";
}

// ---- The UI-effect node kinds the CLIENT renders (and ONLY these) ----------

/** A form node: collect typed values, submit continues the flow (§10). */
export interface FlowFormNode {
  readonly kind: "form";
  /** Server-assigned node id, echoed back so the server correlates the step. */
  readonly id: string;
  readonly title?: string;
  readonly fields: readonly FlowFormField[];
  readonly submitLabel?: string;
  /** When true the runner offers a cancel affordance taking the onCancel edge. */
  readonly cancelable?: boolean;
}

/** A display node: render server-provided read-only content, then continue. */
export interface FlowDisplayNode {
  readonly kind: "display";
  readonly id: string;
  readonly title?: string;
  /** Read-only text/markup string the server already rendered/sanitized. */
  readonly body: string;
  readonly continueLabel?: string;
}

/** A choice node: the user picks one option; its value is the step input. */
export interface FlowChoiceNode {
  readonly kind: "choice";
  readonly id: string;
  readonly title?: string;
  readonly prompt?: string;
  readonly options: readonly FlowChoiceOption[];
}

/** A message node: a transient toast-like notice; continues automatically or on ack. */
export interface FlowMessageNode {
  readonly kind: "message";
  readonly id: string;
  readonly text: string;
  readonly tone?: "info" | "success" | "error";
  readonly ackLabel?: string;
}

/**
 * A terminal node: the flow is done. The client stops here and renders the
 * outcome; it never calls `advance` from a terminal node. The server marks
 * terminality — the client does not infer it.
 */
export interface FlowTerminalNode {
  readonly kind: "terminal";
  readonly id: string;
  readonly title?: string;
  readonly message?: string;
  readonly tone?: "success" | "error" | "info";
}

/** The discriminated union of client-renderable nodes (UI-effect + terminal). */
export type FlowNode =
  | FlowFormNode
  | FlowDisplayNode
  | FlowChoiceNode
  | FlowMessageNode
  | FlowTerminalNode;

/** Opaque server state threaded through each step; the client never reads into it. */
export type FlowState = unknown;

/** The input a step submits back to the server (form values / choice value / ack). */
export type FlowInput = Record<string, unknown> | null;

/**
 * The host-injected resolver that owns ALL authority + branching. Given the
 * current opaque state and the step's input, it returns the next node (which may
 * be terminal). ksui never decides what comes next — it only renders + POSTs.
 */
export type FlowAdvance = (state: FlowState, input: FlowInput) => Promise<FlowNode>;

/** True for the terminal node kind (the runner stops calling `advance`). */
export function isTerminal(node: FlowNode): node is FlowTerminalNode {
  return node.kind === "terminal";
}

/** True for a node the runner submits user input from (form/choice/message). */
export function collectsInput(node: FlowNode): node is FlowFormNode | FlowChoiceNode {
  return node.kind === "form" || node.kind === "choice";
}

/**
 * Build the input payload for a form node from its current field values,
 * dropping undefined and coercing nothing (the server re-validates — §10.5).
 * Pure helper so submission shaping is testable without a DOM.
 */
export function formNodeInput(
  node: FlowFormNode,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of node.fields) {
    const v = values[f.key];
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

/**
 * Which required form fields are still empty. Client-side gating is UX only;
 * the kernel re-validates every rule server-side (§10.5) — this never authorizes.
 */
export function missingRequired(
  node: FlowFormNode,
  values: Record<string, unknown>,
): string[] {
  const missing: string[] = [];
  for (const f of node.fields) {
    if (!f.required) continue;
    const v = values[f.key];
    if (v === undefined || v === null || v === "") missing.push(f.key);
  }
  return missing;
}
