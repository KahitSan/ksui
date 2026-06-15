import { createMemo, Show, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

type IconComponent = (props: { size?: number; class?: string }) => JSX.Element;

/** Public tone vocabulary, shared with StatusPill for consistency. */
export type KpiTone = "success" | "danger" | "info" | "warning";

// Domain-free tone record. Each tone supplies a Tailwind text class for the
// label icon + value and a literal SVG stroke color for the sparkline.
const TONE: Record<KpiTone, { text: string; stroke: string }> = {
  success: { text: "text-emerald-400", stroke: "#34d399" },
  danger: { text: "text-red-400", stroke: "#f87171" },
  info: { text: "text-blue-400", stroke: "#60a5fa" },
  warning: { text: "text-amber-400", stroke: "#fbbf24" },
};

// Module-private counter so each card's sparkline gradient gets a unique id,
// even when many cards render on one page.
let _kpiIdCounter = 0;
function nextKpiId(): number {
  return ++_kpiIdCounter;
}

export interface KpiCardProps {
  /** Short uppercase caption above the value. */
  label: string;
  /** Pre-formatted value string. The caller formats currency/numbers; the
   *  card never formats. */
  value: string;
  /** Color intent for the icon, value, and sparkline. */
  tone: KpiTone;
  /** Lucide (or any) icon component rendered top-right. */
  icon: IconComponent;
  /** Optional small caption under the value. */
  hint?: string;
  /** Optional numeric series rendered as an inline-SVG sparkline. Needs at
   *  least two points to draw. */
  sparkline?: number[];
  /** Optional clip/shape utility class. Defaults to none, so the tile renders
   *  with a plain rounded border and no host-specific CSS required. */
  clipClass?: string;
  /** Extra classes on the outer tile. */
  class?: string;
}

// A compact KPI tile: caption, big tone-colored value, optional hint, and an
// optional sparkline. Presentational only — no data fetching, no formatting.
export default function KpiCard(props: KpiCardProps): JSX.Element {
  const gradId = `spark-${nextKpiId()}`;
  const t = () => TONE[props.tone];
  const sparkPath = createMemo(() => {
    const data = props.sparkline;
    if (!data || data.length < 2) return null;
    const w = 100;
    const h = 24;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return [x, y] as const;
    });
    const d = pts
      .map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1))
      .join(" ");
    const area = d + ` L${w},${h} L0,${h} Z`;
    return { line: d, area };
  });

  return (
    <div
      class={`rounded-lg border border-zinc-800/50 bg-zinc-900/50 p-4 relative overflow-hidden ${
        props.clipClass ?? ""
      } ${props.class ?? ""}`}
    >
      <div class="flex items-start justify-between mb-3">
        <span class="text-[10px] text-zinc-500 uppercase tracking-[0.25em] font-semibold">
          {props.label}
        </span>
        <div class={`flex items-center justify-center ${t().text}`}>
          <Dynamic component={props.icon} size={16} />
        </div>
      </div>
      <div class="flex items-end justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div
            class={`text-base sm:text-lg lg:text-xl font-bold leading-tight tabular-nums ${t().text}`}
          >
            {props.value}
          </div>
          <Show when={props.hint}>
            <div class="text-[11px] text-zinc-600 mt-1">{props.hint}</div>
          </Show>
        </div>
        <Show when={sparkPath()}>
          {(p) => (
            <svg
              viewBox="0 0 100 24"
              preserveAspectRatio="none"
              class="w-[56px] h-[22px] shrink-0 opacity-90"
            >
              <defs>
                <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stop-color={t().stroke} stop-opacity="0.3" />
                  <stop offset="100%" stop-color={t().stroke} stop-opacity="0" />
                </linearGradient>
              </defs>
              <path d={p().area} fill={`url(#${gradId})`} />
              <path
                d={p().line}
                fill="none"
                stroke={t().stroke}
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          )}
        </Show>
      </div>
    </div>
  );
}
