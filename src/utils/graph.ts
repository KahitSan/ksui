// Domain-free directed-graph model + a deterministic, dependency-free layout.
// Powers the FlowGraph renderer. No DOM, no solid — pure functions so the
// layout is unit-testable in isolation. ksui ships no graph library (solid +
// lucide only), so layering is a small longest-path pass, not dagre/d3.

export type GraphAccent = "primary" | "info" | "success" | "danger" | "muted";

export interface GraphNode {
  /** Stable unique id; edges reference nodes by this. */
  id: string;
  label: string;
  /** Secondary line under the label (e.g. a tier, a category, a count). */
  sublabel?: string;
  accent?: GraphAccent;
  /**
   * Explicit column index. Overrides automatic layering when set — required for
   * a clean bipartite split when a sink node has no edges (e.g. an ungranted
   * permission still belongs in the right column).
   */
  lane?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  /**
   * Render the connector dashed — e.g. "requires" vs a solid "provides", or a
   * denied grant vs an allowed one.
   */
  dashed?: boolean;
  accent?: GraphAccent;
}

export type GraphLayout = "layered" | "bipartite";

export interface PositionedNode extends GraphNode {
  lane: number;
  row: number;
  x: number;
  y: number;
}

export interface GraphLayoutResult {
  nodes: PositionedNode[];
  /** id → positioned node, for edge endpoint lookup. */
  byId: Map<string, PositionedNode>;
  width: number;
  height: number;
}

export interface GraphMetrics {
  nodeW: number;
  nodeH: number;
  gapX: number;
  gapY: number;
  pad: number;
}

export const DEFAULT_METRICS: GraphMetrics = {
  nodeW: 168,
  nodeH: 48,
  gapX: 72,
  gapY: 18,
  pad: 16,
};

/** Count incoming edges per node id, ignoring edges that dangle off the set. */
function incomingDegree(ids: Set<string>, edges: GraphEdge[]): Map<string, number> {
  const incoming = new Map<string, number>();
  for (const id of ids) incoming.set(id, 0);
  for (const e of edges) {
    if (ids.has(e.from) && ids.has(e.to)) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }
  return incoming;
}

/** Assign each node a lane (column index). Explicit `node.lane` always wins. */
function assignLanes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  layout: GraphLayout,
): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const pinned = new Set(nodes.filter((n) => typeof n.lane === "number").map((n) => n.id));
  const lane = new Map<string, number>();
  for (const n of nodes) if (typeof n.lane === "number") lane.set(n.id, n.lane);

  const incoming = incomingDegree(ids, edges);

  if (layout === "bipartite") {
    // Sources (nothing points at them) on the left, sinks on the right.
    for (const n of nodes) {
      if (lane.has(n.id)) continue;
      lane.set(n.id, (incoming.get(n.id) ?? 0) > 0 ? 1 : 0);
    }
    return lane;
  }

  // Layered: longest-path layering. Roots (no incoming) start at 0; relax each
  // edge so a target sits at least one lane past its source. Cap the passes at
  // node-count so a cycle can't spin forever.
  for (const n of nodes) if (!lane.has(n.id)) lane.set(n.id, 0);
  const live = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const e of live) {
      if (pinned.has(e.to)) continue; // don't move a caller-pinned node
      const want = (lane.get(e.from) ?? 0) + 1;
      if (want > (lane.get(e.to) ?? 0)) {
        lane.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return lane;
}

/**
 * Compute node positions for the graph. Lanes flow left→right; within a lane,
 * nodes stack top-down in input order (stable, so the render is deterministic).
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  layout: GraphLayout = "layered",
  metrics: GraphMetrics = DEFAULT_METRICS,
): GraphLayoutResult {
  const { nodeW, nodeH, gapX, gapY, pad } = metrics;
  const lane = assignLanes(nodes, edges, layout);

  const nextRow = new Map<number, number>(); // lane → next free row
  const positioned: PositionedNode[] = nodes.map((n) => {
    const l = lane.get(n.id) ?? 0;
    const r = nextRow.get(l) ?? 0;
    nextRow.set(l, r + 1);
    return {
      ...n,
      lane: l,
      row: r,
      x: pad + l * (nodeW + gapX),
      y: pad + r * (nodeH + gapY),
    };
  });

  const lanes = positioned.reduce((m, n) => Math.max(m, n.lane + 1), 0);
  const maxRows = [...nextRow.values()].reduce((m, v) => Math.max(m, v), 0);
  const width = lanes > 0 ? pad * 2 + lanes * nodeW + (lanes - 1) * gapX : pad * 2;
  const height = maxRows > 0 ? pad * 2 + maxRows * nodeH + (maxRows - 1) * gapY : pad * 2;

  const byId = new Map(positioned.map((n) => [n.id, n]));
  return { nodes: positioned, byId, width, height };
}
