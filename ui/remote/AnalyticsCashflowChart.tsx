// Daily inflow-vs-outflow bar chart for the Analytics page. Hand-rolled from divs
// (no charting lib) — hovering a day lifts its bars and swaps the legend + heading
// to that bucket's figures; unhovered, the legend shows the period totals.
import { createMemo, createSignal, For, Show } from "solid-js";
import { ChartLegend } from "@kahitsan/ksui";
import { formatCurrency } from "./lib/format";
import {
  fmtFullDateLocal,
  fmtShortDateLocal,
  type CashflowBucket,
} from "./analytics-shared";

export default function AnalyticsCashflowChart(props: {
  buckets: CashflowBucket[];
}) {
  const [hover, setHover] = createSignal<number | null>(null);
  const buckets = () => props.buckets;
  const maxAbs = createMemo(() =>
    Math.max(1, ...buckets().flatMap((b) => [b.in, b.out]))
  );
  const totals = createMemo(() => {
    const inSum = buckets().reduce((s, b) => s + b.in, 0);
    const outSum = buckets().reduce((s, b) => s + b.out, 0);
    return { inSum, outSum, net: inSum - outSum };
  });
  const active = () => {
    const i = hover();
    return i != null ? buckets()[i] : null;
  };
  /** The hovered bucket's net, or the period net when nothing is hovered — lifted
   *  out of the JSX so the value and its color class read from one source. */
  const netLegendValue = () => {
    const b = active();
    return b ? b.in - b.out : totals().net;
  };

  return (
    <div class="rounded-lg border border-zinc-800/50 bg-zinc-900/50 p-5 ks-hud-clip-top-left-bottom-right">
      <div class="flex items-start justify-between mb-4 gap-4">
        <div class="min-w-0">
          <p class="text-[10px] tracking-[0.3em] uppercase text-amber-400 font-semibold mb-1">
            Cash flow
          </p>
          <h3 class="text-base font-bold text-zinc-100 truncate">
            <Show when={active()} fallback="Daily inflow vs outflow">
              {(b) => fmtFullDateLocal(b().date)}
            </Show>
          </h3>
        </div>
        <div class="flex items-center gap-4 flex-wrap justify-end">
          <ChartLegend
            dot="bg-emerald-400"
            label="Money in"
            value={formatCurrency(active()?.in ?? totals().inSum)}
          />
          <ChartLegend
            dot="bg-red-400"
            label="Money out"
            value={formatCurrency(active()?.out ?? totals().outSum)}
          />
          <ChartLegend
            dot="bg-amber-400"
            label="Net"
            value={formatCurrency(netLegendValue())}
            valueColor={
              netLegendValue() >= 0 ? "text-emerald-400" : "text-red-400"
            }
          />
        </div>
      </div>

      <Show
        when={buckets().length > 0}
        fallback={
          <div class="h-40 flex items-center justify-center text-xs text-zinc-600">
            No activity in this period.
          </div>
        }
      >
        <div
          class="relative h-40 flex items-end gap-[3px]"
          onMouseLeave={() => setHover(null)}
        >
          <div class="absolute left-0 right-0 top-1/2 border-t border-zinc-800/70 pointer-events-none" />
          <For each={buckets()}>
            {(b, i) => {
              const inH = (b.in / maxAbs()) * 50;
              const outH = (b.out / maxAbs()) * 50;
              const isHover = () => hover() === i();
              return (
                <div
                  class="relative flex-1 h-full flex flex-col justify-center cursor-pointer"
                  onMouseEnter={() => setHover(i())}
                >
                  <div class="flex-1 flex items-end justify-center">
                    <div
                      class="w-full transition-all duration-150"
                      classList={{
                        "bg-emerald-300": isHover(),
                        "bg-emerald-500/70": !isHover(),
                      }}
                      style={{ height: inH + "%" }}
                    />
                  </div>
                  <div class="flex-1 flex items-start justify-center">
                    <div
                      class="w-full transition-all duration-150"
                      classList={{
                        "bg-red-300": isHover(),
                        "bg-red-500/70": !isHover(),
                      }}
                      style={{ height: outH + "%" }}
                    />
                  </div>
                </div>
              );
            }}
          </For>
        </div>
        <div class="flex justify-between mt-2 text-[10px] text-zinc-600 tabular-nums">
          <span>{fmtShortDateLocal(buckets()[0]?.date)}</span>
          <Show when={buckets().length > 2}>
            <span>
              {fmtShortDateLocal(
                buckets()[Math.floor(buckets().length / 2)]?.date
              )}
            </span>
          </Show>
          <span>
            {fmtShortDateLocal(buckets()[buckets().length - 1]?.date)}
          </span>
        </div>
      </Show>
    </div>
  );
}
