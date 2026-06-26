// flow-builder: node-step authoring → FlowDefinition. Tests linear chaining and
// the condition fork (both arms captured).
import { describe, expect, it } from "vitest";
import { buildFlow } from "./flow-builder";
import { flowToGraph } from "./flow-spec";

describe("buildFlow", () => {
  it("chains linear steps into a connected path", () => {
    const def = buildFlow("item.create", "Add Item", (f) => {
      f.trigger("Add Item button").modal("Item form").commit("Create", "POST /api/items");
    });
    expect(def.nodes.map((n) => n.kind)).toEqual(["trigger", "modal", "commit"]);
    const { edges } = flowToGraph(def);
    // trigger → modal → commit
    expect(edges).toHaveLength(2);
    expect(edges[0].from).toBe(def.nodes[0].id);
    expect(edges[0].to).toBe(def.nodes[1].id);
    expect(edges[1].to).toBe(def.nodes[2].id);
  });

  it("forks a condition into two labelled branches, both rendered", () => {
    const def = buildFlow("cart.checkout", "Checkout", (f) => {
      f.trigger("Checkout button")
        .modal("Coupon entry")
        .condition(
          "Coupon valid?",
          (yes) => yes.call("pricing:validate").compute("Apply discount").commit("Place order"),
          (no) => no.commit("Place order"),
        );
    });
    const cond = def.nodes.find((n) => n.kind === "condition")!;
    // exactly two outgoing branches, to DIFFERENT nodes, each labelled
    expect(cond.out).toHaveLength(2);
    expect(cond.out![0].to).not.toBe(cond.out![1].to);
    expect(cond.out!.map((p) => p.label)).toEqual(["yes", "no"]);
    // the "yes" arm carries the validate→compute→commit chain
    expect(def.nodes.some((n) => n.kind === "call" && n.detail === "pricing:validate")).toBe(true);
    expect(def.nodes.filter((n) => n.kind === "commit")).toHaveLength(2);
    // every edge resolves (defineFlow would have thrown otherwise)
    const { nodes, edges } = flowToGraph(def);
    const ids = new Set(nodes.map((n) => n.id));
    expect(edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
  });
});
