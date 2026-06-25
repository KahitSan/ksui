// flow-spec: the node-based program model + its lowering to the graph the canvas
// draws. Tests the parse step (flowToGraph) and the dangling-edge guard.
import { describe, expect, it } from "vitest";
import { defineFlow, edge, node, flowToGraph } from "./flow-spec";

describe("defineFlow", () => {
  it("returns the definition unchanged when edges are valid", () => {
    const def = defineFlow({
      id: "demo",
      title: "Demo",
      nodes: [
        node("a", "trigger", "Start", { out: [edge("b")] }),
        node("b", "terminal", "Done"),
      ],
    });
    expect(def.nodes).toHaveLength(2);
  });

  it("throws on an edge to an unknown node", () => {
    expect(() =>
      defineFlow({
        id: "bad",
        title: "Bad",
        nodes: [node("a", "trigger", "Start", { out: [edge("ghost")] })],
      }),
    ).toThrow(/unknown node "ghost"/);
  });
});

describe("flowToGraph", () => {
  it("lowers nodes (kind + detail) and edges (branch labels) to the graph model", () => {
    const { nodes, edges } = flowToGraph({
      id: "checkout",
      title: "Checkout",
      nodes: [
        node("pick", "trigger", "Pick voucher", { out: [edge("validate", "voucher chosen")] }),
        node("validate", "call", "Validate", { detail: "vouchers.validate", out: [edge("done")] }),
        node("done", "effect", "Refresh"),
      ],
    });
    expect(nodes.map((n) => n.kind)).toEqual(["trigger", "call", "effect"]);
    // detail becomes the sublabel; kind falls back when no detail
    expect(nodes[1].sublabel).toBe("vouchers.validate");
    expect(nodes[0].sublabel).toBe("trigger");
    // a named branch is dashed + labeled; the default "out" is solid + unlabeled
    const branch = edges.find((e) => e.from === "pick")!;
    expect(branch.label).toBe("voucher chosen");
    expect(branch.dashed).toBe(true);
    const plain = edges.find((e) => e.from === "validate")!;
    expect(plain.dashed).toBe(false);
    expect(plain.label).toBeUndefined();
  });
});
