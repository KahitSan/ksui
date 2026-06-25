// FlowGraph (Vision §9 companion to FlowRunner): a read-only renderer for a
// DECLARATIVE node graph. Where FlowRunner *executes* a server-driven flow,
// FlowGraph *draws* a static relationship graph — plugin connections, a
// role→permission map, any directed graph the host hands it.
//
// Composite because it composes the pure graph model (utils/graph) with SVG
// layout + interaction. Domain-free: it knows nothing about plugins or roles;
// the host supplies typed nodes/edges and an optional click handler. Self-
// contained CSS (ksui-fg-* unscoped classes + CSS custom props); no Tailwind,
// no host-brand classes (standalone-library rule).

import type { Component, JSX } from "solid-js";
import { For, Show, createMemo } from "solid-js";
import {
  DEFAULT_METRICS,
  layoutGraph,
  type GraphEdge,
  type GraphLayout,
  type GraphNode,
  type PositionedNode,
} from "../../utils/graph";

const STYLE_ID = "ksui-flow-graph-style";

function ensureStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.ksui-fg-wrap{width:100%;overflow:auto;}
.ksui-fg-svg{display:block;max-width:100%;height:auto;font-family:inherit;}
.ksui-fg-edge{fill:none;stroke:var(--ksui-fg-edge,rgba(255,255,255,0.22));stroke-width:1.5;}
.ksui-fg-edge.dashed{stroke-dasharray:4 4;}
.ksui-fg-edge.primary{stroke:var(--ksui-fg-primary,#c9a961);}
.ksui-fg-edge.info{stroke:#3b82f6;}
.ksui-fg-edge.success{stroke:#22c55e;}
.ksui-fg-edge.danger{stroke:#ef4444;}
.ksui-fg-edge.muted{stroke:rgba(255,255,255,0.14);}
.ksui-fg-elabel{fill:var(--ksui-fg-muted,rgba(255,255,255,0.7));font-size:9px;}
.ksui-fg-elabel-bg{fill:var(--ksui-fg-bg,#18181b);opacity:0.82;}
.ksui-fg-box{fill:var(--ksui-fg-node-bg,rgba(255,255,255,0.04));stroke:var(--ksui-fg-node-border,rgba(255,255,255,0.16));stroke-width:1;}
.ksui-fg-node.primary .ksui-fg-box{stroke:var(--ksui-fg-primary,#c9a961);fill:rgba(201,169,97,0.08);}
.ksui-fg-node.info .ksui-fg-box{stroke:#3b82f6;fill:rgba(59,130,246,0.08);}
.ksui-fg-node.success .ksui-fg-box{stroke:#22c55e;fill:rgba(34,197,94,0.08);}
.ksui-fg-node.danger .ksui-fg-box{stroke:#ef4444;fill:rgba(239,68,68,0.08);}
.ksui-fg-node.muted .ksui-fg-box{stroke:rgba(255,255,255,0.16);fill:rgba(255,255,255,0.02);}
.ksui-fg-node.clickable{cursor:pointer;}
.ksui-fg-node.clickable:hover .ksui-fg-box{fill:rgba(255,255,255,0.10);}
.ksui-fg-node.clickable:focus{outline:none;}
.ksui-fg-node.clickable:focus-visible .ksui-fg-box{stroke:var(--ksui-fg-primary,#c9a961);stroke-width:2;}
.ksui-fg-label{fill:var(--ksui-fg-fg,#e4e4e7);font-size:12px;font-weight:600;}
.ksui-fg-sublabel{fill:var(--ksui-fg-muted,rgba(255,255,255,0.55));font-size:9.5px;}
.ksui-fg-empty{padding:1.75rem 1rem;text-align:center;font-size:0.82rem;color:var(--ksui-fg-muted,rgba(255,255,255,0.55));}
`;
  document.head.appendChild(style);
}

export interface FlowGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** "layered" (default) flows roots→leaves; "bipartite" splits source/sink. */
  layout?: GraphLayout;
  /** Shown when there are no nodes to draw. */
  emptyLabel?: string;
  /** Accessible description of the whole graph (the svg's aria-label). */
  ariaLabel?: string;
  /** When supplied, nodes become buttons that fire this with the node id. */
  onNodeSelect?: (id: string) => void;
  testId?: string;
}

/** SVG has no text overflow; trim to keep labels inside the node box. */
function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

const { nodeW, nodeH } = DEFAULT_METRICS;

export const FlowGraph: Component<FlowGraphProps> = (props) => {
  ensureStyle();
  const tid = (s: string) => (props.testId ? `${props.testId}-${s}` : undefined);

  const laid = createMemo(() =>
    layoutGraph(props.nodes, props.edges, props.layout ?? "layered"),
  );

  // A cubic bezier from a source node's right edge to a target's left edge.
  const edgePath = (s: PositionedNode, t: PositionedNode): string => {
    const x1 = s.x + nodeW;
    const y1 = s.y + nodeH / 2;
    const x2 = t.x;
    const y2 = t.y + nodeH / 2;
    const dx = Math.max(36, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  const activate = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      props.onNodeSelect?.(id);
    }
  };

  return (
    <div class="ksui-fg-wrap" data-testid={tid("root")}>
      <Show
        when={laid().nodes.length > 0}
        fallback={
          <p class="ksui-fg-empty" data-testid={tid("empty")}>
            {props.emptyLabel ?? "Nothing to show yet."}
          </p>
        }
      >
        <svg
          class="ksui-fg-svg"
          viewBox={`0 0 ${laid().width} ${laid().height}`}
          width={laid().width}
          height={laid().height}
          role="img"
          aria-label={props.ariaLabel ?? "Relationship graph"}
          data-testid={tid("svg")}
        >
          <defs>
            <marker
              id="ksui-fg-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L8 4 L0 8 z" fill="var(--ksui-fg-edge,rgba(255,255,255,0.35))" />
            </marker>
          </defs>

          {/* Edges first so nodes paint on top of the connectors. */}
          <For each={props.edges}>
            {(e) => {
              const s = () => laid().byId.get(e.from);
              const t = () => laid().byId.get(e.to);
              return (
                <Show when={s() && t()}>
                  {(() => {
                    const src = s() as PositionedNode;
                    const dst = t() as PositionedNode;
                    const mx = (src.x + nodeW + dst.x) / 2;
                    const my = (src.y + dst.y) / 2 + nodeH / 2;
                    return (
                      <g>
                        <path
                          class={`ksui-fg-edge ${e.accent ?? ""} ${e.dashed ? "dashed" : ""}`}
                          d={edgePath(src, dst)}
                          marker-end="url(#ksui-fg-arrow)"
                        />
                        <Show when={e.label}>
                          <rect
                            class="ksui-fg-elabel-bg"
                            x={mx - clip(e.label!, 18).length * 2.6 - 3}
                            y={my - 7}
                            width={clip(e.label!, 18).length * 5.2 + 6}
                            height={12}
                            rx={2}
                          />
                          <text class="ksui-fg-elabel" x={mx} y={my + 2} text-anchor="middle">
                            {clip(e.label!, 18)}
                          </text>
                        </Show>
                      </g>
                    );
                  })()}
                </Show>
              );
            }}
          </For>

          {/* Nodes */}
          <For each={laid().nodes}>
            {(n) => {
              const interactive = () => typeof props.onNodeSelect === "function";
              return (
                <g
                  class={`ksui-fg-node ${n.accent ?? ""} ${interactive() ? "clickable" : ""}`}
                  transform={`translate(${n.x} ${n.y})`}
                  data-testid={tid(`node-${n.id}`)}
                  role={interactive() ? "button" : undefined}
                  tabindex={interactive() ? 0 : undefined}
                  aria-label={n.sublabel ? `${n.label} — ${n.sublabel}` : n.label}
                  onClick={interactive() ? () => props.onNodeSelect!(n.id) : undefined}
                  onKeyDown={interactive() ? (ev) => activate(ev, n.id) : undefined}
                >
                  <rect class="ksui-fg-box" width={nodeW} height={nodeH} rx={8} />
                  <text
                    class="ksui-fg-label"
                    x={12}
                    y={n.sublabel ? 20 : nodeH / 2 + 4}
                  >
                    {clip(n.label, 24)}
                  </text>
                  <Show when={n.sublabel}>
                    <text class="ksui-fg-sublabel" x={12} y={34}>
                      {clip(n.sublabel!, 28)}
                    </text>
                  </Show>
                </g>
              );
            }}
          </For>
        </svg>
      </Show>
    </div>
  ) as JSX.Element;
};

export default FlowGraph;
