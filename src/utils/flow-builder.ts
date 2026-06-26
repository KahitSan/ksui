// Node-step authoring DSL — a fluent builder for a flow/node-graph definition.
// An author wraps steps in calls (`f.trigger(...)`, `f.condition(label, onYes,
// onNo)`, `f.call(...)`, …); each call appends a node wired from the previous
// step, and a condition forks into two labelled branches. The whole thing lowers
// to a `FlowDefinition` the FlowGraph renders.
//
// Authoring with steps — instead of hand-building node/edge data — is what keeps
// the diagram parseable and in lockstep with the code that declares it: the same
// call tree that (in a step-running runtime) drives the behaviour is what gets
// rendered. This is optional, additive sugar over `defineFlow`; consumers can
// still build a `FlowDefinition` directly with `node`/`edge` if they prefer.

import {
  defineFlow,
  type FlowDefinition,
  type FlowNodeDef,
  type FlowNodeKind,
} from "./flow-spec";

/**
 * A node-step recorder. Linear steps chain (`f.trigger(...).load(...).commit(...)`);
 * `condition` forks into two labelled branches that recurse with the SAME node
 * list, so the full tree — both arms, not just the one a runtime would take — is
 * captured for the diagram. Branch builders share `nodes` (and thus the running
 * id sequence via `nodes.length`), so ids never collide across arms.
 */
export class FlowSteps {
  constructor(
    readonly prefix: string,
    readonly nodes: FlowNodeDef[] = [],
    private tail: string | null = null,
    private pendingLabel?: string,
  ) {}

  private step(kind: FlowNodeKind, label: string, detail?: string): this {
    const id = `${this.prefix}_${kind}_${this.nodes.length}`;
    this.nodes.push({ id, kind, label, ...(detail ? { detail } : {}) });
    if (this.tail) {
      const prev = this.nodes.find((n) => n.id === this.tail);
      if (prev) {
        prev.out = prev.out ?? [];
        const bl = this.pendingLabel;
        prev.out.push(bl ? { id: bl, to: id, label: bl } : { id: "out", to: id });
      }
    }
    this.tail = id;
    this.pendingLabel = undefined; // a fork label applies only to the first step of the arm
    return this;
  }

  /** A UI event that starts/continues the flow (a button, a selection). */
  trigger(label: string): this {
    return this.step("trigger", label);
  }
  /** A data source / list the screen shows. */
  data(label: string, detail?: string): this {
    return this.step("data", label, detail);
  }
  /** A fetch/load into the current screen. */
  load(label: string, detail?: string): this {
    return this.step("load", label, detail);
  }
  /** Opens an overlay / form. */
  modal(label: string): this {
    return this.step("modal", label);
  }
  /** A call out to another service/capability; `target` is its identifier. */
  call(target: string, label?: string): this {
    return this.step("call", label ?? target, target);
  }
  /** A pure computation (apply a discount, total a cart). */
  compute(label: string): this {
    return this.step("compute", label);
  }
  /** A write / command. */
  commit(label: string, detail?: string): this {
    return this.step("commit", label, detail);
  }
  /** Emits a domain event. */
  emit(event: string): this {
    return this.step("emit", event);
  }
  /** A UI effect — refresh / toast / navigate / close. */
  effect(label: string): this {
    return this.step("effect", label);
  }
  /** An end state. */
  terminal(label: string): this {
    return this.step("terminal", label);
  }

  /**
   * A two-way branch. `onYes`/`onNo` each receive a builder rooted at the
   * condition so both arms render; `labels` annotates the two out-edges
   * (default "yes"/"no").
   */
  condition(
    label: string,
    onYes: (yes: FlowSteps) => void,
    onNo: (no: FlowSteps) => void,
    labels: readonly [string, string] = ["yes", "no"],
  ): this {
    this.step("condition", label);
    const cond = this.tail as string;
    onYes(new FlowSteps(this.prefix, this.nodes, cond, labels[0]));
    onNo(new FlowSteps(this.prefix, this.nodes, cond, labels[1]));
    return this;
  }
}

/** Author one flow from node steps. The returned definition is identity-checked
 *  (`defineFlow` throws on a dangling edge) and renders on the FlowGraph canvas. */
export function buildFlow(
  id: string,
  title: string,
  build: (f: FlowSteps) => void,
): FlowDefinition {
  const f = new FlowSteps(id.replace(/[^a-zA-Z0-9]+/g, "_"));
  build(f);
  return defineFlow({ id, title, nodes: f.nodes });
}
