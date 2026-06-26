---
"@kahitsan/ksui": minor
---

Refine `buildFlow`/`FlowSteps` (added in 0.25.0, no consumers yet) into a node-graph builder: each step returns a connectable handle and you wire them with `handle.to(target, label?)`, so linear paths chain (`a.to(b).to(c)`) while branches, joins and loops fall out of connecting a handle more than once. The previous version could only express linear chains + binary conditions, which can't represent real flows (lists with many row-actions, loop-backs, converging paths). Still additive sugar over `defineFlow`, still domain-free.
