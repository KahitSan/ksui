// example-start
import { ChartLegend } from "@kahitsan/ksui";

export default function ChartLegendBasic() {
  // ChartLegend is one entry in a chart legend: a small colored dot, an
  // uppercase label, and a pre-formatted value beneath it. Here we line up the
  // three series a cashflow chart usually shows: money in, money out, and net.
  return (
    <div
      style={{
        padding: "1.5rem",
        display: "flex",
        gap: "2rem",
        "flex-wrap": "wrap",
        "align-items": "flex-start",
      }}
    >
      <ChartLegend dot="bg-emerald-400" label="Money in" value="₱128,400" valueColor="text-emerald-400" />
      <ChartLegend dot="bg-rose-400" label="Money out" value="₱74,950" valueColor="text-rose-400" />
      <ChartLegend dot="bg-sky-400" label="Net" value="₱53,450" />
    </div>
  );
}
