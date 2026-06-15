// example-start
import { ProgressBar } from "@kahitsan/ksui";
import { Timer } from "lucide-solid";

export default function ProgressBarBasic() {
  // The color is picked up from a color name inside the `class` prop
  // (green, blue, amber, red, purple, slate...). The fill, indicator,
  // and shimmer all tint to match. A value over 100 shows an overflow
  // band, so the bar can report "past the limit" too.
  return (
    <div
      style={{
        padding: "1.5rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1rem",
      }}
    >
      <ProgressBar progress={64} label="Uploading files" class="blue" />

      <ProgressBar
        progress={92}
        label="Almost done"
        statusLabel="3 of 4"
        class="green"
        shimmer
      />

      <ProgressBar
        progress={45}
        icon={Timer}
        statusLabel="12:30"
        label="Session time"
        position="right"
        rightLabel="07:30 left"
        class="amber"
      />

      <ProgressBar progress={118} label="Over budget" class="red" />

      <ProgressBar progress={30} label="No percentage shown" hidePercentage class="purple" />
    </div>
  );
}
