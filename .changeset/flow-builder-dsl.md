---
"@kahitsan/ksui": minor
---

Add `buildFlow` + `FlowSteps` — a small, optional node-step authoring DSL for composing a `FlowDefinition` by chaining steps (`f.trigger(...).load(...).commit(...)`) with a forking `condition(label, onYes, onNo)` that captures both branches. It lowers to the same `FlowDefinition` the FlowGraph renders, so it's purely additive sugar over `defineFlow` — consumers can keep building flows from `node`/`edge` directly. Domain-free: every step is a generic node kind, no app or transport assumptions.
