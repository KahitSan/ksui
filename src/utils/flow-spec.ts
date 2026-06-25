// Node-based program model — a plugin's behavior as a graph of connectable
// nodes (game-engine / n8n style). This is the SOURCE OF TRUTH a viewer renders
// and (in future) an editor edits; the diagram is just its projection. Pure +
// serializable: no DOM, no solid, no app/domain assumptions. `flowToGraph`
// lowers a FlowDefinition into the generic GraphNode/GraphEdge the FlowGraph
// canvas draws — that lowering IS the "automatically visualized" step.

import type { GraphAccent, GraphEdge, GraphNode } from "./graph";

/**
 * The kinds of node a behavior graph is built from. Spans the WHOLE plugin —
 * data sources, UI triggers, modals, loads, peer calls, computations, branches,
 * writes and events — so a non-technical reader sees the real behavior, not an
 * RPC list.
 */
export type FlowNodeKind =
  | "data" // a data source / list (e.g. "list availments")
  | "trigger" // a UI event that starts or continues the graph (button, selection)
  | "modal" // opens an overlay / screen
  | "load" // fetches/loads data into the current screen
  | "call" // a cross-plugin capability call
  | "compute" // a pure computation (e.g. apply a discount)
  | "condition" // a branch
  | "commit" // a mutation / write (a command)
  | "emit" // emits a domain event
  | "effect" // a UI effect (refresh / toast / navigate)
  | "terminal"; // an end state

/** One outgoing connection from a node. `id` is the branch name ("out" = the
 *  single default output); `label` annotates the edge ("voucher chosen"). */
export interface FlowPort {
  id: string;
  to: string;
  label?: string;
}

export interface FlowNodeDef {
  id: string;
  kind: FlowNodeKind;
  label: string;
  /** Secondary line: a `peer.method` for a call, the computed field for a
   *  compute, the data source for a load — what makes the node concrete. */
  detail?: string;
  /** Outgoing connections (control/data flow). Omitted/empty = a leaf. */
  out?: FlowPort[];
}

export interface FlowDefinition {
  id: string;
  title: string;
  /** Entry node id; defaults to the first node when omitted. */
  entry?: string;
  nodes: FlowNodeDef[];
}

/** Author a connection. `edge("charge")` or `edge("charge", "voucher chosen")`. */
export function edge(to: string, label?: string): FlowPort {
  return label === undefined ? { id: "out", to } : { id: label, to, label };
}

/** Author one node. Sugar over the literal so authored graphs read top-down. */
export function node(
  id: string,
  kind: FlowNodeKind,
  label: string,
  opts?: { detail?: string; out?: FlowPort[] },
): FlowNodeDef {
  return { id, kind, label, detail: opts?.detail, out: opts?.out };
}

/** Identity + light validation: the authored graph IS the definition. Throws on
 *  a dangling edge so an author catches a typo'd target id immediately. */
export function defineFlow(def: FlowDefinition): FlowDefinition {
  const ids = new Set(def.nodes.map((n) => n.id));
  for (const n of def.nodes) {
    for (const p of n.out ?? []) {
      if (!ids.has(p.to)) {
        throw new Error(`flow "${def.id}": node "${n.id}" connects to unknown node "${p.to}"`);
      }
    }
  }
  return def;
}

/** Visual accent per node kind — keeps the palette consistent across consumers. */
const KIND_ACCENT: Record<FlowNodeKind, GraphAccent> = {
  data: "info",
  trigger: "primary",
  modal: "info",
  load: "muted",
  call: "success",
  compute: "primary",
  condition: "danger",
  commit: "success",
  emit: "info",
  effect: "muted",
  terminal: "muted",
};

/**
 * Lower a FlowDefinition to the generic graph model the FlowGraph canvas draws.
 * Node `kind` flows through (the renderer maps it to an icon); `detail` becomes
 * the sublabel; branch ports become labeled edges. This is the parse step: one
 * declarative source → one diagram, no hand-drawing.
 */
export function flowToGraph(def: FlowDefinition): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = def.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    sublabel: n.detail ?? n.kind,
    kind: n.kind,
    accent: KIND_ACCENT[n.kind],
  }));
  const edges: GraphEdge[] = def.nodes.flatMap((n) =>
    (n.out ?? []).map((p) => ({
      from: n.id,
      to: p.to,
      label: p.label,
      // A named (non-default) branch reads as conditional — draw it dashed.
      dashed: p.id !== "out",
    })),
  );
  return { nodes, edges };
}
