// example-start
import { createSignal } from "solid-js";
import { DatePicker, type DateRangeValue } from "@kahitsan/ksui";

export default function DatePickerBasic() {
  // Single date. The value is an ISO YYYY-MM-DD string (or null).
  const [day, setDay] = createSignal<string | null>(null);
  // Range. The value is a { start, end } pair of ISO strings (or nulls).
  const [range, setRange] = createSignal<DateRangeValue>({ start: null, end: null });

  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1.25rem",
      }}
    >
      <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
        <label class="block text-xs font-medium text-zinc-400 uppercase tracking-wide">Single date</label>
        <DatePicker value={day()} onChange={setDay} placeholder="Pick date" />
        <span class="text-sm text-zinc-400">
          Selected: <span class="text-zinc-100">{day() ?? "— none —"}</span>
        </span>
      </div>

      <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
        <label class="block text-xs font-medium text-zinc-400 uppercase tracking-wide">Date range</label>
        <DatePicker range value={range()} onChange={setRange} placeholder="Pick range" />
        <span class="text-sm text-zinc-400">
          From <span class="text-zinc-100">{range().start ?? "—"}</span> to{" "}
          <span class="text-zinc-100">{range().end ?? "—"}</span>
        </span>
      </div>
    </div>
  );
}
