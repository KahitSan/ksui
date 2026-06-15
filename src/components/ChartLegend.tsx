// ChartLegend renders a single legend entry for a chart: a small colored dot,
// an uppercase label, and a value beneath it. Used by cashflow / analytics
// charts to label each series (money in, money out, net) with its current
// total. Purely presentational; the caller supplies the dot color class, the
// label, the formatted value, and an optional value color override.

interface ChartLegendProps {
  /** Tailwind background class for the legend dot (e.g. "bg-emerald-400"). */
  dot: string;
  /** Uppercase label shown above the value (e.g. "Money in"). */
  label: string;
  /** Pre-formatted value string (e.g. a currency string). */
  value: string;
  /** Optional Tailwind text color class for the value. Defaults to text-zinc-100. */
  valueColor?: string;
}

export default function ChartLegend(props: ChartLegendProps) {
  return (
    <div class="flex items-center gap-2">
      <span class={`w-2 h-2 rounded-sm ${props.dot}`} />
      <div class="flex flex-col">
        <span class="text-[9px] uppercase tracking-widest text-zinc-500 font-medium leading-tight">
          {props.label}
        </span>
        <span
          class={`text-xs font-bold tabular-nums leading-tight ${props.valueColor || "text-zinc-100"}`}
        >
          {props.value}
        </span>
      </div>
    </div>
  );
}
