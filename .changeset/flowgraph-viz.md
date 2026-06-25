---
"@kahitsan/ksui": minor
---

Add FlowGraph — a read-only renderer for a declarative directed graph (the static companion to FlowRunner). Domain-free: the host supplies typed nodes/edges and an optional node-select handler. Supports a layered layout (roots→leaves longest-path) and a bipartite split, draws SVG nodes + bezier edges with self-contained CSS, and ships a dependency-free `layoutGraph` util. Powers plugin-connection and role→permission visualizations.
