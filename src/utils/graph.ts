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
   * Optional node-type tag (e.g. a flow node kind: trigger/call/effect). The
   * renderer maps it to an icon for a blueprint/automation-tool look; the layout
   * ignores it. Kept a plain string so the graph model stays serializable.
   */
  kind?: string;
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

/** Flow direction: lanes (depth from root) run left→right or top→bottom. */
export type GraphDirection = "horizontal" | "vertical";

/**
 * Compute node positions for the graph. `direction` decides whether lanes
 * (depth) flow left→right ("horizontal", default) or top→bottom ("vertical");
 * within a lane, nodes stack along the cross axis in input order (stable, so the
 * render is deterministic).
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  layout: GraphLayout = "layered",
  metrics: GraphMetrics = DEFAULT_METRICS,
  direction: GraphDirection = "horizontal",
): GraphLayoutResult {
  const { nodeW, nodeH, gapX, gapY, pad } = metrics;
  const lane = assignLanes(nodes, edges, layout);
  const vertical = direction === "vertical";

  // Cross-axis ("slot") placement by barycenter, computed PER connected
  // component then packed side by side — so a single-child chain runs straight,
  // branches spread tidily under their parent, and two independent flows (e.g.
  // a board vs. an action flow) sit compactly next to each other instead of
  // drifting far apart.
  const slot = componentSlots(nodes, edges, lane);

  const positioned: PositionedNode[] = nodes.map((n) => {
    const l = lane.get(n.id) ?? 0;
    const s = slot.get(n.id) ?? 0;
    // Depth axis = lane; cross axis = slot. Vertical: depth↓ (y), cross↔ (x).
    return {
      ...n,
      lane: l,
      row: Math.round(s),
      x: pad + (vertical ? s * (nodeW + gapX) : l * (nodeW + gapX)),
      y: pad + (vertical ? l * (nodeH + gapY) : s * (nodeH + gapY)),
    };
  });

  const maxX = positioned.reduce((m, n) => Math.max(m, n.x), pad);
  const maxY = positioned.reduce((m, n) => Math.max(m, n.y), pad);
  const width = maxX + nodeW + pad;
  const height = maxY + nodeH + pad;

  const byId = new Map(positioned.map((n) => [n.id, n]));
  return { nodes: positioned, byId, width, height };
}

/**
 * Cross-axis slots computed PER connected component, packed side by side. Each
 * independent flow (e.g. a board vs. an action flow) is laid out compactly on
 * its own and offset past the previous one, so disconnected flows sit close
 * together instead of drifting apart.
 */
function componentSlots(
  nodes: GraphNode[],
  edges: GraphEdge[],
  lane: Map<string, number>,
): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const parent = new Map<string, string>(nodes.map((n) => [n.id, n.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) {
      const next = parent.get(x)!;
      parent.set(x, r);
      x = next;
    }
    return r;
  };
  for (const e of edges) {
    if (ids.has(e.from) && ids.has(e.to)) parent.set(find(e.from), find(e.to));
  }
  // Group nodes by component, preserving input order for stability.
  const comps = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const r = find(n.id);
    (comps.get(r) ?? comps.set(r, []).get(r)!).push(n);
  }

  const slot = new Map<string, number>();
  let offset = 0;
  for (const compNodes of comps.values()) {
    const compIds = new Set(compNodes.map((n) => n.id));
    const compEdges = edges.filter((e) => compIds.has(e.from) && compIds.has(e.to));
    const local = barycenterSlots(compNodes, compEdges, lane);
    let maxLocal = 0;
    for (const [id, s] of local) {
      slot.set(id, s + offset);
      maxLocal = Math.max(maxLocal, s);
    }
    offset += maxLocal + 2; // a 2-slot gap between independent flows
  }
  return slot;
}

/**
 * Assign each node a cross-axis slot (0-based, may be fractional after
 * centering) via a few barycenter sweeps with overlap resolution — a small
 * Sugiyama-style ordering so the drawing is tidy without a layout library.
 */
function barycenterSlots(
  nodes: GraphNode[],
  edges: GraphEdge[],
  lane: Map<string, number>,
): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const byLane = new Map<number, string[]>();
  for (const n of nodes) {
    const l = lane.get(n.id) ?? 0;
    const arr = byLane.get(l) ?? [];
    arr.push(n.id);
    byLane.set(l, arr);
  }
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    (children.get(e.from) ?? children.set(e.from, []).get(e.from)!).push(e.to);
    (parents.get(e.to) ?? parents.set(e.to, []).get(e.to)!).push(e.from);
  }

  const slot = new Map<string, number>();
  for (const arr of byLane.values()) arr.forEach((id, i) => slot.set(id, i));

  const lanesAsc = [...byLane.keys()].sort((a, b) => a - b);
  const avg = (xs: string[]) =>
    xs.length ? xs.reduce((s, id) => s + (slot.get(id) ?? 0), 0) / xs.length : null;

  for (let iter = 0; iter < 6; iter++) {
    const down = iter % 2 === 0;
    const order = down ? lanesAsc : [...lanesAsc].reverse();
    for (const l of order) {
      const arr = byLane.get(l)!;
      const want = arr.map((id) => {
        const ref = down ? parents.get(id) : children.get(id);
        return avg(ref ?? []) ?? slot.get(id) ?? 0;
      });
      // Order by desired slot, then lay out left→right enforcing a 1-slot gap.
      const idx = arr.map((_, i) => i).sort((a, b) => want[a] - want[b]);
      let prev = -Infinity;
      for (const i of idx) {
        const s = Math.max(want[i], prev + 1);
        slot.set(arr[i], s);
        prev = s;
      }
    }
  }

  // Normalize so the smallest slot is 0.
  const min = Math.min(...[...slot.values()], 0);
  for (const [id, s] of slot) slot.set(id, s - min);
  return slot;
}
