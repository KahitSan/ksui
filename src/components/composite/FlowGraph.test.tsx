// FlowGraph tests: the pure layout (lanes, dimensions, bipartite/layered) and
// the SVG render (nodes, edges, empty state, node selection).
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import FlowGraph from "./FlowGraph";
import { layoutGraph, DEFAULT_METRICS, type GraphEdge, type GraphNode } from "../../utils/graph";

const { nodeW, gapX, pad } = DEFAULT_METRICS;

describe("layoutGraph", () => {
  it("layers roots→leaves by longest path", () => {
    const nodes: GraphNode[] = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];
    const edges: GraphEdge[] = [{ from: "a", to: "b" }, { from: "b", to: "c" }];
    const { byId } = layoutGraph(nodes, edges, "layered");
    expect(byId.get("a")!.lane).toBe(0);
    expect(byId.get("b")!.lane).toBe(1);
    expect(byId.get("c")!.lane).toBe(2);
  });

  it("uses the longest path when a node has two incoming depths", () => {
    // a→c and a→b→c: c must sit past b, not just past a.
    const nodes: GraphNode[] = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];
    const edges: GraphEdge[] = [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c" }];
    const { byId } = layoutGraph(nodes, edges, "layered");
    expect(byId.get("c")!.lane).toBe(2);
  });

  it("splits bipartite by incoming degree, honoring explicit lanes for isolated sinks", () => {
    const nodes: GraphNode[] = [
      { id: "role", label: "admin" },
      { id: "p1", label: "view" },
      { id: "p2", label: "delete", lane: 1 }, // ungranted permission, no edge
    ];
    const edges: GraphEdge[] = [{ from: "role", to: "p1" }];
    const { byId } = layoutGraph(nodes, edges, "bipartite");
    expect(byId.get("role")!.lane).toBe(0);
    expect(byId.get("p1")!.lane).toBe(1);
    expect(byId.get("p2")!.lane).toBe(1); // pinned, despite no incoming edge
  });

  it("does not spin forever on a cycle", () => {
    const nodes: GraphNode[] = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
    const edges: GraphEdge[] = [{ from: "a", to: "b" }, { from: "b", to: "a" }];
    const { nodes: out } = layoutGraph(nodes, edges, "layered");
    expect(out).toHaveLength(2);
  });

  it("positions the second lane one node-width + gap past the first", () => {
    const nodes: GraphNode[] = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
    const { byId } = layoutGraph(nodes, [{ from: "a", to: "b" }], "layered");
    expect(byId.get("a")!.x).toBe(pad);
    expect(byId.get("b")!.x).toBe(pad + nodeW + gapX);
  });

  it("ignores edges that dangle off the node set", () => {
    const { nodes } = layoutGraph([{ id: "a", label: "A" }], [{ from: "a", to: "ghost" }], "layered");
    expect(nodes).toHaveLength(1);
  });
});

describe("FlowGraph", () => {
  it("renders a node per input node and an svg", () => {
    const { getByTestId } = render(() => (
      <FlowGraph
        testId="fg"
        nodes={[{ id: "a", label: "Alpha", sublabel: "base" }, { id: "b", label: "Beta" }]}
        edges={[{ from: "a", to: "b" }]}
      />
    ));
    expect(getByTestId("fg-svg")).toBeTruthy();
    expect(getByTestId("fg-node-a")).toBeTruthy();
    expect(getByTestId("fg-node-b")).toBeTruthy();
  });

  it("shows the empty state when there are no nodes", () => {
    const { getByTestId, queryByTestId } = render(() => (
      <FlowGraph testId="fg" nodes={[]} edges={[]} emptyLabel="No connections" />
    ));
    expect(getByTestId("fg-empty").textContent).toContain("No connections");
    expect(queryByTestId("fg-svg")).toBeNull();
  });

  it("makes nodes interactive only when onNodeSelect is supplied", () => {
    const onNodeSelect = vi.fn();
    const { getByTestId } = render(() => (
      <FlowGraph
        testId="fg"
        nodes={[{ id: "a", label: "Alpha" }]}
        edges={[]}
        onNodeSelect={onNodeSelect}
      />
    ));
    const node = getByTestId("fg-node-a");
    expect(node.getAttribute("role")).toBe("button");
    fireEvent.click(node);
    expect(onNodeSelect).toHaveBeenCalledWith("a");
  });

  it("does not mark nodes as buttons without a handler", () => {
    const { getByTestId } = render(() => (
      <FlowGraph testId="fg" nodes={[{ id: "a", label: "Alpha" }]} edges={[]} />
    ));
    expect(getByTestId("fg-node-a").getAttribute("role")).toBeNull();
  });

  it("renders pan/zoom controls only when interactive", () => {
    const staticGraph = render(() => (
      <FlowGraph testId="s" nodes={[{ id: "a", label: "A" }]} edges={[]} />
    ));
    expect(staticGraph.queryByTestId("s-controls")).toBeNull();

    const canvas = render(() => (
      <FlowGraph testId="c" interactive nodes={[{ id: "a", label: "A" }]} edges={[]} />
    ));
    expect(canvas.getByTestId("c-controls")).toBeTruthy();
    expect(canvas.getByTestId("c-reset")).toBeTruthy();
    // interactive svg fills the viewport rather than sizing to content
    expect(canvas.getByTestId("c-svg").getAttribute("width")).toBe("100%");
  });

  it("animates edges with the flow class only when animated", () => {
    const { container } = render(() => (
      <FlowGraph
        testId="fg"
        animated
        nodes={[{ id: "a", label: "A" }, { id: "b", label: "B" }]}
        edges={[{ from: "a", to: "b" }]}
      />
    ));
    expect(container.querySelector(".ksui-fg-edge.flow")).toBeTruthy();

    const plain = render(() => (
      <FlowGraph
        nodes={[{ id: "a", label: "A" }, { id: "b", label: "B" }]}
        edges={[{ from: "a", to: "b" }]}
      />
    ));
    expect(plain.container.querySelector(".ksui-fg-edge.flow")).toBeNull();
  });
});
