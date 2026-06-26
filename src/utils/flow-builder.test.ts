// flow-builder: node-step authoring → FlowDefinition. Tests linear chaining and
// a real graph (branch + loop + join), which the builder must express 1:1.
import { describe, expect, it } from "vitest";
import { buildFlow } from "./flow-builder";
import { flowToGraph } from "./flow-spec";

describe("buildFlow", () => {
  it("chains linear steps into a connected path", () => {
    const def = buildFlow("item.create", "Add Item", (f) => {
      const t = f.trigger("Add Item button");
      const m = f.modal("Item form");
      const c = f.commit("Create", "POST /api/items");
      t.to(m).to(c);
    });
    expect(def.nodes.map((n) => n.kind)).toEqual(["trigger", "modal", "commit"]);
    const { edges } = flowToGraph(def);
    expect(edges.map((e) => [e.from, e.to])).toEqual([
      [def.nodes[0].id, def.nodes[1].id],
      [def.nodes[1].id, def.nodes[2].id],
    ]);
  });

  it("expresses a branch, a loop, and a join (a real graph, not a tree)", () => {
    const def = buildFlow("cart.checkout", "Checkout", (f) => {
      const list = f.data("Items");
      const open = f.trigger("Checkout button");
      const form = f.modal("Coupon entry");
      const valid = f.condition("Coupon valid?");
      const apply = f.compute("Apply discount");
      const place = f.commit("Place order");
      list.to(open).to(form).to(valid);
      valid.to(apply, "yes").to(place); // yes arm
      valid.to(form, "no"); // LOOP back to the form
      apply.to(place); // (place already reached from apply) — keep single
      place.to(list, "done"); // JOIN/loop back to the list
    });

    const cond = def.nodes.find((n) => n.kind === "condition")!;
    expect(cond.out!.map((p) => p.label).sort()).toEqual(["no", "yes"]);

    // a back-edge exists (loop): some edge points to an earlier node
    const order = new Map(def.nodes.map((n, i) => [n.id, i] as const));
    const { nodes, edges } = flowToGraph(def);
    expect(edges.some((e) => order.get(e.to)! <= order.get(e.from)!)).toBe(true);
    // a join exists: some node has in-degree > 1
    const indeg: Record<string, number> = {};
    edges.forEach((e) => (indeg[e.to] = (indeg[e.to] ?? 0) + 1));
    expect(Object.values(indeg).some((d) => d > 1)).toBe(true);
    // every edge resolves (defineFlow would have thrown on a dangling one)
    const ids = new Set(nodes.map((n) => n.id));
    expect(edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
  });
});
