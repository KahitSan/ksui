---
"@kahitsan/ksui": minor
---

FlowGraph: add an interactive canvas mode. New `interactive` prop enables drag-to-pan + scroll/buttons-to-zoom (a plain SVG group transform — no canvas library), `animated` makes edges flow as marching dashes toward the arrowhead (honoring prefers-reduced-motion), and `height` sets the canvas viewport. Static mode is unchanged. Node sublabels now render as uppercase kind tags, suiting flow node-kinds (trigger/form/call/effect).
