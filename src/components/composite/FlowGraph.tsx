// FlowGraph — a blueprint/automation-tool renderer for a declarative node graph
// (the projection of a FlowDefinition; see utils/flow-spec). Where FlowRunner
// *executes* a flow, FlowGraph *draws* it as connectable node cards — the way a
// game-engine node editor or n8n shows behavior. With `interactive` it's a
// pan/zoom canvas; with `animated` the connectors flow toward the arrowhead.
//
// Composite: composes the pure graph model (utils/graph) with SVG edges + HTML
// node cards (foreignObject) + interaction. Domain-free; self-contained CSS
// (ksui-fg-* classes + CSS custom props); no Tailwind, no host-brand classes;
// no graph/canvas library — pan/zoom is a group transform, layout is the pure
// layoutGraph. Connectors are drawn BEHIND the opaque cards so an edge never
// visibly crosses a node block.

import type { Component, JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import Database from "lucide-solid/icons/database";
import MousePointerClick from "lucide-solid/icons/mouse-pointer-click";
import AppWindow from "lucide-solid/icons/app-window";
import DownloadCloud from "lucide-solid/icons/download-cloud";
import ArrowLeftRight from "lucide-solid/icons/arrow-left-right";
import Calculator from "lucide-solid/icons/calculator";
import GitBranch from "lucide-solid/icons/git-branch";
import Save from "lucide-solid/icons/save";
import Radio from "lucide-solid/icons/radio";
import Sparkles from "lucide-solid/icons/sparkles";
import CircleCheck from "lucide-solid/icons/circle-check-big";
import Circle from "lucide-solid/icons/circle";
import {
  layoutGraph,
  type GraphDirection,
  type GraphEdge,
  type GraphLayout,
  type GraphMetrics,
  type GraphNode,
  type PositionedNode,
} from "../../utils/graph";

type IconComp = Component<{ size?: number; class?: string }>;

// Blueprint node-kind → icon. Unknown kinds fall back to a plain dot.
const KIND_ICON: Record<string, IconComp> = {
  data: Database,
  trigger: MousePointerClick,
  modal: AppWindow,
  load: DownloadCloud,
  call: ArrowLeftRight,
  compute: Calculator,
  condition: GitBranch,
  commit: Save,
  emit: Radio,
  effect: Sparkles,
  terminal: CircleCheck,
};
const iconFor = (kind?: string): IconComp => KIND_ICON[kind ?? ""] ?? Circle;

// Roomier than the default metrics so connectors have space and cards breathe.
const METRICS: GraphMetrics = { nodeW: 190, nodeH: 60, gapX: 96, gapY: 30, pad: 26 };
const { nodeW, nodeH, pad } = METRICS;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;

const STYLE_ID = "ksui-flow-graph-style";

function ensureStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.ksui-fg-wrap{width:100%;overflow:auto;position:relative;}
.ksui-fg-wrap.interactive{overflow:hidden;border:1px solid var(--ksui-fg-node-border,rgba(255,255,255,0.12));border-radius:10px;background:var(--ksui-fg-canvas,#101014);background-image:radial-gradient(var(--ksui-fg-dot,rgba(255,255,255,0.05)) 1px,transparent 1px);background-size:20px 20px;cursor:grab;touch-action:none;}
.ksui-fg-wrap.interactive.grabbing{cursor:grabbing;}
.ksui-fg-wrap.scroll{overflow:auto;border:1px solid var(--ksui-fg-node-border,rgba(255,255,255,0.12));border-radius:10px;background:var(--ksui-fg-canvas,#101014);background-image:radial-gradient(var(--ksui-fg-dot,rgba(255,255,255,0.05)) 1px,transparent 1px);background-size:20px 20px;}
.ksui-fg-svg{display:block;max-width:100%;height:auto;font-family:inherit;}
.ksui-fg-wrap.scroll .ksui-fg-svg{margin:0 auto;}
.ksui-fg-wrap.interactive .ksui-fg-svg{max-width:none;width:100%;height:100%;}
.ksui-fg-edge{fill:none;stroke:var(--ksui-fg-edge,rgba(255,255,255,0.28));stroke-width:1.75;}
.ksui-fg-edge.dashed{stroke-dasharray:5 4;}
.ksui-fg-edge.primary{stroke:var(--ksui-fg-primary,#c9a961);}
.ksui-fg-edge.info{stroke:#5b9bf0;}
.ksui-fg-edge.success{stroke:#43c478;}
.ksui-fg-edge.danger{stroke:#ef6a6a;}
.ksui-fg-edge.muted{stroke:rgba(255,255,255,0.2);}
.ksui-fg-edge.flow{stroke-dasharray:6 5;animation:ksui-fg-march .8s linear infinite;}
@keyframes ksui-fg-march{to{stroke-dashoffset:-11;}}
@media (prefers-reduced-motion:reduce){.ksui-fg-edge.flow{animation:none;}}
.ksui-fg-handle{fill:var(--ksui-fg-canvas,#101014);stroke:var(--ksui-fg-edge,rgba(255,255,255,0.4));stroke-width:1.5;}
.ksui-fg-node,.ksui-fg-edge,.ksui-fg-elabel,.ksui-fg-elabel-bg,.ksui-fg-handle{transition:opacity .12s ease;}
.ksui-fg-dim{opacity:0.14;}
.ksui-fg-elabel{fill:var(--ksui-fg-muted,rgba(255,255,255,0.78));font-size:9.5px;}
.ksui-fg-elabel-bg{fill:var(--ksui-fg-canvas,#101014);opacity:0.92;}
.ksui-fg-card{box-sizing:border-box;height:100%;display:flex;align-items:center;gap:9px;padding:0 11px;border-radius:9px;background:var(--ksui-fg-card,#1c1c22);border:1px solid var(--ksui-fg-node-border,rgba(255,255,255,0.14));border-left-width:3px;overflow:hidden;}
.ksui-fg-node.clickable .ksui-fg-card{cursor:pointer;}
.ksui-fg-node.clickable .ksui-fg-card:hover{background:#23232b;}
.ksui-fg-node:focus{outline:none;}
.ksui-fg-node:focus-visible .ksui-fg-card{border-color:var(--ksui-fg-primary,#c9a961);}
.ksui-fg-chip{flex:none;width:30px;height:30px;border-radius:7px;display:flex;align-items:center;justify-content:center;color:#fff;}
.ksui-fg-txt{min-width:0;display:flex;flex-direction:column;line-height:1.15;}
.ksui-fg-title{font-size:12px;font-weight:600;color:var(--ksui-fg-fg,#ececef);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ksui-fg-kind{font-size:9px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ksui-fg-muted,rgba(255,255,255,0.45));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ksui-fg-card.primary{border-left-color:#c9a961;} .ksui-fg-card.primary .ksui-fg-chip{background:#c9a961;color:#18181b;}
.ksui-fg-card.info{border-left-color:#5b9bf0;} .ksui-fg-card.info .ksui-fg-chip{background:#3f6fb0;}
.ksui-fg-card.success{border-left-color:#43c478;} .ksui-fg-card.success .ksui-fg-chip{background:#2f8e57;}
.ksui-fg-card.danger{border-left-color:#ef6a6a;} .ksui-fg-card.danger .ksui-fg-chip{background:#b04545;}
.ksui-fg-card.muted{border-left-color:rgba(255,255,255,0.3);} .ksui-fg-card.muted .ksui-fg-chip{background:#3a3a42;}
.ksui-fg-empty{padding:1.75rem 1rem;text-align:center;font-size:0.82rem;color:var(--ksui-fg-muted,rgba(255,255,255,0.55));}
.ksui-fg-controls{position:absolute;right:8px;bottom:8px;display:flex;gap:4px;z-index:1;}
.ksui-fg-ctrl{width:24px;height:24px;display:grid;place-items:center;border-radius:5px;border:1px solid var(--ksui-fg-node-border,rgba(255,255,255,0.18));background:var(--ksui-fg-card,#1c1c22);color:var(--ksui-fg-fg,#ececef);font-size:14px;line-height:1;cursor:pointer;user-select:none;}
.ksui-fg-ctrl:hover{background:#23232b;}
.ksui-fg-hint{position:absolute;left:8px;bottom:8px;font-size:9.5px;color:var(--ksui-fg-muted,rgba(255,255,255,0.4));pointer-events:none;}
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
  /** When supplied, node cards become buttons that fire this with the node id. */
  onNodeSelect?: (id: string) => void;
  /** Turn the graph into a pan (drag) + zoom (wheel/buttons) canvas. Ignored for
   *  vertical direction, which scrolls instead. */
  interactive?: boolean;
  /** Animate connectors as marching dashes flowing toward the arrowhead. */
  animated?: boolean;
  /** "horizontal" (default) flows left→right; "vertical" flows top→bottom and
   *  renders in a scrollable panel (scroll to follow the flow). */
  direction?: GraphDirection;
  /** Viewport height in px — canvas height (horizontal) or max scroll height
   *  (vertical). Default 360. */
  height?: number;
  testId?: string;
}

/** Trim a label to fit the card (CSS ellipsis also guards, but keep SVG sane). */
function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export const FlowGraph: Component<FlowGraphProps> = (props) => {
  ensureStyle();
  const tid = (s: string) => (props.testId ? `${props.testId}-${s}` : undefined);

  const vertical = () => props.direction === "vertical";
  // Pan/zoom canvas applies whenever interactive — in BOTH directions. Direction
  // only changes the layout axis + how connectors leave/enter the cards.
  const canvas = () => !!props.interactive;
  const laid = createMemo(() =>
    layoutGraph(props.nodes, props.edges, props.layout ?? "layered", METRICS, props.direction),
  );

  // Node ports: a node shows an INPUT handle only when something feeds it (so a
  // trigger/root has none), and one OUTPUT handle per outgoing edge — a 2-branch
  // condition therefore has two output handles, each driving a distinct edge.
  const ports = createMemo(() => {
    const incoming = new Set<string>();
    const outBySource = new Map<string, GraphEdge[]>();
    for (const e of props.edges) {
      incoming.add(e.to);
      const arr = outBySource.get(e.from) ?? [];
      arr.push(e);
      outBySource.set(e.from, arr);
    }
    return { incoming, outBySource };
  });

  // The position of a node's i-th output handle (of n), spread along the leaving
  // edge (bottom for vertical, right for horizontal). A single output centers.
  const outHandle = (src: PositionedNode, i: number, n: number): { x: number; y: number } => {
    const f = (i + 1) / (n + 1);
    return vertical()
      ? { x: src.x + nodeW * f, y: src.y + nodeH }
      : { x: src.x + nodeW, y: src.y + nodeH * f };
  };
  const inHandle = (dst: PositionedNode): { x: number; y: number } =>
    vertical()
      ? { x: dst.x + nodeW / 2, y: dst.y }
      : { x: dst.x, y: dst.y + nodeH / 2 };

  // ── Node drag (move a node; edges follow) ──────────────────────────────────
  const [offsets, setOffsets] = createSignal<Record<string, { dx: number; dy: number }>>({});
  // The drawn position of a node = its laid-out slot + any drag offset.
  const pos = (n: PositionedNode): PositionedNode => {
    const o = offsets()[n.id];
    return o ? { ...n, x: n.x + o.dx, y: n.y + o.dy } : n;
  };
  const drawn = (id: string): PositionedNode | undefined => {
    const n = laid().byId.get(id);
    return n ? pos(n) : undefined;
  };

  // ── Highlight (hover/click dims everything not connected) ──────────────────
  const [hover, setHover] = createSignal<string | null>(null);
  const [pinned, setPinned] = createSignal<string | null>(null);
  const active = () => pinned() ?? hover();
  const lit = createMemo<Set<string> | null>(() => {
    const a = active();
    if (!a) return null;
    const s = new Set<string>([a]);
    for (const e of props.edges) {
      if (e.from === a) s.add(e.to);
      if (e.to === a) s.add(e.from);
    }
    return s;
  });
  const nodeDim = (id: string) => lit() !== null && !lit()!.has(id);
  const edgeDim = (e: GraphEdge) =>
    lit() !== null && !(lit()!.has(e.from) && lit()!.has(e.to) && (e.from === active() || e.to === active()));

  const [view, setView] = createSignal({ x: 0, y: 0, k: 1 });
  const [grabbing, setGrabbing] = createSignal(false);
  let svgRef: SVGSVGElement | undefined;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = false;

  // Fit the whole graph into the viewport (zoom-to-fit), centered, from the
  // ACTUAL drawn bounding box (including any drag offsets) so the reset control
  // always frames everything regardless of pan/zoom/drag state.
  const fitView = () => {
    if (!svgRef) return;
    const rect = svgRef.getBoundingClientRect();
    const vw = rect.width;
    const vh = rect.height;
    const ns = laid().nodes.map(pos);
    if (!vw || !vh || ns.length === 0) return;
    const minX = Math.min(...ns.map((n) => n.x)) - pad;
    const minY = Math.min(...ns.map((n) => n.y)) - pad;
    const maxX = Math.max(...ns.map((n) => n.x)) + nodeW + pad;
    const maxY = Math.max(...ns.map((n) => n.y)) + nodeH + pad;
    const gw = Math.max(1, maxX - minX);
    const gh = Math.max(1, maxY - minY);
    const k = Math.min(vw / gw, vh / gh, 1.4);
    setView({ x: (vw - gw * k) / 2 - minX * k, y: (vh - gh * k) / 2 - minY * k, k });
  };
  // Default placement on first load: NOT zoom-to-fit (keep 1:1), just pan so the
  // graph's top is centered horizontally and visible — otherwise a centered
  // layout can sit off-screen. The Fit control still zooms-to-fit on demand.
  let placed = false;
  createEffect(() => {
    if (canvas() && !placed && laid().nodes.length > 0 && svgRef) {
      placed = true;
      requestAnimationFrame(() => {
        if (!svgRef) return;
        const vw = svgRef.clientWidth || 0;
        const ns = laid().nodes.map(pos);
        if (!vw || ns.length === 0) return;
        const minX = Math.min(...ns.map((n) => n.x));
        const maxX = Math.max(...ns.map((n) => n.x)) + nodeW;
        setView({ x: vw / 2 - (minX + maxX) / 2, y: 0, k: 1 });
      });
    }
  });

  const clampK = (k: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
  const zoomBy = (factor: number, cx?: number, cy?: number) => {
    const v = view();
    const k = clampK(v.k * factor);
    const px = cx ?? (svgRef?.clientWidth ?? 0) / 2;
    const py = cy ?? (svgRef?.clientHeight ?? 0) / 2;
    setView({ x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k), k });
  };
  const onWheel = (e: WheelEvent) => {
    if (!canvas()) return;
    e.preventDefault();
    const rect = svgRef?.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0));
  };
  // A press that started on a node card (recorded by the card's handler) becomes
  // a node-drag; a press on empty canvas pans. svgRef captures the pointer so the
  // gesture continues even when it leaves the element.
  let pendingNode: string | null = null;
  let nodeDrag: string | null = null;
  const onPointerDown = (e: PointerEvent) => {
    if (!canvas()) return;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    svgRef?.setPointerCapture(e.pointerId);
    if (pendingNode) {
      nodeDrag = pendingNode;
      pendingNode = null;
    } else {
      dragging = true;
      setGrabbing(true);
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging && !nodeDrag) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    lastX = e.clientX;
    lastY = e.clientY;
    if (nodeDrag) {
      const id = nodeDrag;
      const k = view().k || 1;
      setOffsets((o) => {
        const cur = o[id] ?? { dx: 0, dy: 0 };
        return { ...o, [id]: { dx: cur.dx + dx / k, dy: cur.dy + dy / k } };
      });
    } else {
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };
  const endDrag = (e: PointerEvent) => {
    // A press on a node that didn't move = a click → toggle its pinned highlight.
    // A press on empty canvas that didn't move = a click-away → clear the focus.
    if (nodeDrag && !moved) setPinned((p) => (p === nodeDrag ? null : nodeDrag));
    else if (dragging && !moved) setPinned(null);
    dragging = false;
    nodeDrag = null;
    pendingNode = null;
    setGrabbing(false);
    try {
      svgRef?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  // Bezier from a source output handle to a target input handle. Control points
  // pulled along the flow axis (down for vertical, right for horizontal) so the
  // curve bows through the gaps rather than cutting across rows.
  const edgePath = (a: { x: number; y: number }, b: { x: number; y: number }): string => {
    if (vertical()) {
      const dy = Math.max(34, Math.abs(b.y - a.y) * 0.5);
      return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy}, ${b.x} ${b.y - dy}, ${b.x} ${b.y}`;
    }
    const dx = Math.max(46, Math.abs(b.x - a.x) * 0.5);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  const selectNode = (id: string) => {
    if (moved) return;
    props.onNodeSelect?.(id);
  };
  const activate = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      props.onNodeSelect?.(id);
    }
  };
  const groupTransform = () =>
    canvas() ? `translate(${view().x} ${view().y}) scale(${view().k})` : undefined;

  return (
    <div
      class="ksui-fg-wrap"
      classList={{ interactive: canvas(), scroll: vertical(), grabbing: grabbing() }}
      style={
        canvas()
          ? { height: `${props.height ?? 360}px` }
          : vertical()
            ? { "max-height": `${props.height ?? 360}px` }
            : undefined
      }
      data-testid={tid("root")}
    >
      <Show
        when={laid().nodes.length > 0}
        fallback={
          <p class="ksui-fg-empty" data-testid={tid("empty")}>
            {props.emptyLabel ?? "Nothing to show yet."}
          </p>
        }
      >
        <svg
          ref={svgRef}
          class="ksui-fg-svg"
          viewBox={canvas() ? undefined : `0 0 ${laid().width} ${laid().height}`}
          width={canvas() ? "100%" : laid().width}
          height={canvas() ? "100%" : laid().height}
          role="img"
          aria-label={props.ariaLabel ?? "Flow graph"}
          data-testid={tid("svg")}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
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
              <path d="M0 0 L8 4 L0 8 z" fill="var(--ksui-fg-edge,rgba(255,255,255,0.45))" />
            </marker>
          </defs>

          <g transform={groupTransform()}>
            {/* 1) Connectors — drawn first so the opaque cards paint over them. */}
            <For each={props.edges}>
              {(e) => {
                const s = () => drawn(e.from);
                const t = () => drawn(e.to);
                return (
                  <Show when={s() && t()}>
                    {(() => {
                      const src = s() as PositionedNode;
                      const dst = t() as PositionedNode;
                      const sibs = ports().outBySource.get(e.from) ?? [];
                      const a = outHandle(src, Math.max(0, sibs.indexOf(e)), sibs.length || 1);
                      const b = inHandle(dst);
                      const m = mid(a, b);
                      const mx = m.x;
                      const my = m.y;
                      return (
                        <g classList={{ "ksui-fg-dim": edgeDim(e) }}>
                          <path
                            class={`ksui-fg-edge ${e.accent ?? ""} ${e.dashed ? "dashed" : ""} ${
                              props.animated ? "flow" : ""
                            }`}
                            d={edgePath(a, b)}
                            marker-end="url(#ksui-fg-arrow)"
                          />
                          <Show when={e.label}>
                            <rect
                              class="ksui-fg-elabel-bg"
                              x={mx - clip(e.label!, 18).length * 2.7 - 3}
                              y={my - 7}
                              width={clip(e.label!, 18).length * 5.4 + 6}
                              height={12}
                              rx={3}
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

            {/* 2) Node cards (opaque HTML via foreignObject — the blueprint look). */}
            <For each={laid().nodes}>
              {(base) => {
                const n = () => pos(base);
                const clickable = () => typeof props.onNodeSelect === "function";
                return (
                  <foreignObject
                    x={n().x}
                    y={n().y}
                    width={nodeW}
                    height={nodeH}
                    class="ksui-fg-node"
                    classList={{ clickable: clickable(), "ksui-fg-dim": nodeDim(base.id) }}
                    data-testid={tid(`node-${base.id}`)}
                    role={clickable() ? "button" : undefined}
                    tabindex={clickable() ? 0 : undefined}
                    aria-label={base.sublabel ? `${base.label} — ${base.sublabel}` : base.label}
                    onClick={clickable() ? () => selectNode(base.id) : undefined}
                    onKeyDown={clickable() ? (ev) => activate(ev, base.id) : undefined}
                    onPointerDown={canvas() ? () => (pendingNode = base.id) : undefined}
                    onPointerEnter={canvas() ? () => setHover(base.id) : undefined}
                    onPointerLeave={canvas() ? () => setHover(null) : undefined}
                  >
                    <div
                      // @ts-expect-error xmlns switches the foreignObject child back to HTML ns
                      xmlns="http://www.w3.org/1999/xhtml"
                      class={`ksui-fg-card ${base.accent ?? "muted"}`}
                      style={canvas() ? { cursor: "grab" } : { "pointer-events": "none" }}
                    >
                      <span class="ksui-fg-chip">
                        <Dynamic component={iconFor(base.kind)} size={15} />
                      </span>
                      <span class="ksui-fg-txt">
                        <span class="ksui-fg-title">{base.label}</span>
                        <Show when={base.sublabel}>
                          <span class="ksui-fg-kind">{base.sublabel}</span>
                        </Show>
                      </span>
                    </div>
                  </foreignObject>
                );
              }}
            </For>

            {/* 3) I/O port handles, over everything. INPUT only when fed (a
                 trigger/root has none); one OUTPUT per outgoing edge (a 2-branch
                 condition shows two). */}
            <For each={laid().nodes}>
              {(base) => {
                const n = () => pos(base);
                const outs = () => ports().outBySource.get(base.id) ?? [];
                const hasIn = () => ports().incoming.has(base.id);
                return (
                  <g classList={{ "ksui-fg-dim": nodeDim(base.id) }}>
                    <Show when={hasIn()}>
                      {(() => {
                        const p = inHandle(n());
                        return <circle class="ksui-fg-handle in" cx={p.x} cy={p.y} r={3.5} />;
                      })()}
                    </Show>
                    <For each={outs()}>
                      {(_e, i) => {
                        const p = outHandle(n(), i(), outs().length);
                        return <circle class="ksui-fg-handle out" cx={p.x} cy={p.y} r={3.5} />;
                      }}
                    </For>
                  </g>
                );
              }}
            </For>
          </g>
        </svg>

        <Show when={canvas()}>
          <div class="ksui-fg-controls" data-testid={tid("controls")}>
            <button type="button" class="ksui-fg-ctrl" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
              +
            </button>
            <button
              type="button"
              class="ksui-fg-ctrl"
              aria-label="Zoom out"
              onClick={() => zoomBy(1 / 1.2)}
            >
              −
            </button>
            <button
              type="button"
              class="ksui-fg-ctrl"
              aria-label="Fit to view"
              data-testid={tid("reset")}
              onClick={fitView}
            >
              ⤢
            </button>
          </div>
          <span class="ksui-fg-hint">drag to pan · scroll to zoom</span>
        </Show>
      </Show>
    </div>
  ) as JSX.Element;
};

export default FlowGraph;
