// Node-step authoring DSL — a small, optional graph builder for composing a
// `FlowDefinition`. Each step creates a node and returns a handle; you wire
// handles together with `.to(target, label?)`, which returns the target so
// linear paths chain (`a.to(b).to(c)`) while joins, loops and multi-way
// branches fall out of connecting the same handle more than once:
//
//   buildFlow("checkout", "Checkout", (f) => {
//     const list   = f.data("Items");
//     const add    = f.trigger("Add button");
//     const form   = f.modal("Item form");
//     const valid  = f.condition("Valid?");
//     const save   = f.commit("Save", "POST /api/items");
//     list.to(add).to(form).to(valid);
//     valid.to(save, "yes");        // branch
//     valid.to(form, "no");         // loop back to the form
//     save.to(list, "done");        // and back to the list (join)
//   });
//
// It lowers to the same `FlowDefinition` the FlowGraph renders, so it is purely
// additive sugar over `defineFlow` — consumers can still build flows from
// `node`/`edge` directly. Domain-free: every step is a generic node kind, no app
// or transport assumptions.

import {
  defineFlow,
  type FlowDefinition,
  type FlowNodeDef,
  type FlowNodeKind,
} from "./flow-spec";

/** A handle to a created node. `.to(target)` connects this node → target and
 *  returns target, so paths chain; call it again (or from another handle) to
 *  form branches, joins and loops. */
export interface FlowNode {
  readonly id: string;
  to(target: FlowNode, label?: string): FlowNode;
}

/** Graph builder: one method per node kind, each returning a connectable handle. */
export class FlowSteps {
  readonly nodes: FlowNodeDef[] = [];
  constructor(readonly prefix: string) {}

  private make(kind: FlowNodeKind, label: string, detail?: string): FlowNode {
    const def: FlowNodeDef = {
      id: `${this.prefix}_${kind}_${this.nodes.length}`,
      kind,
      label,
      ...(detail ? { detail } : {}),
    };
    this.nodes.push(def);
    const handle: FlowNode = {
      id: def.id,
      to(target: FlowNode, label?: string): FlowNode {
        def.out = def.out ?? [];
        def.out.push(label ? { id: label, to: target.id, label } : { id: "out", to: target.id });
        return target;
      },
    };
    return handle;
  }

  /** A UI event that starts/continues the flow (a button, a selection). */
  trigger(label: string): FlowNode {
    return this.make("trigger", label);
  }
  /** A data source / list the screen shows. */
  data(label: string, detail?: string): FlowNode {
    return this.make("data", label, detail);
  }
  /** A fetch/load into the current screen. */
  load(label: string, detail?: string): FlowNode {
    return this.make("load", label, detail);
  }
  /** Opens an overlay / form. */
  modal(label: string): FlowNode {
    return this.make("modal", label);
  }
  /** A call out to another service/capability; `target` is its identifier. */
  call(target: string, label?: string): FlowNode {
    return this.make("call", label ?? target, target);
  }
  /** A pure computation (apply a discount, total a cart). */
  compute(label: string): FlowNode {
    return this.make("compute", label);
  }
  /** A branch — wire its outcomes with `.to(target, "yes")` / `.to(target, "no")`. */
  condition(label: string): FlowNode {
    return this.make("condition", label);
  }
  /** A write / command. */
  commit(label: string, detail?: string): FlowNode {
    return this.make("commit", label, detail);
  }
  /** Emits a domain event. */
  emit(event: string): FlowNode {
    return this.make("emit", event);
  }
  /** A UI effect — refresh / toast / navigate / close. */
  effect(label: string): FlowNode {
    return this.make("effect", label);
  }
  /** An end state. */
  terminal(label: string): FlowNode {
    return this.make("terminal", label);
  }
}

/** Author one flow by connecting node steps. The returned definition is
 *  identity-checked (`defineFlow` throws on a dangling edge) and renders on the
 *  FlowGraph canvas. */
export function buildFlow(
  id: string,
  title: string,
  build: (f: FlowSteps) => void,
): FlowDefinition {
  const f = new FlowSteps(id.replace(/[^a-zA-Z0-9]+/g, "_"));
  build(f);
  return defineFlow({ id, title, nodes: f.nodes });
}
