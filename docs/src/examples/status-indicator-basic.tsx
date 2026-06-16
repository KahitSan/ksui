// example-start
import { StatusIndicator } from "@kahitsan/ksui";

export default function StatusIndicatorBasic() {
  // StatusIndicator is a colored availability dot + label. The caller maps its
  // own state (open/closed, online/offline, healthy/degraded) to a tone or a
  // plain `online` boolean. Nothing domain-specific lives here.
  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1.5rem",
      }}
    >
      {/* The pulsing "live status" chip with a caption */}
      <StatusIndicator tone="success" pulse caption="Status" label="Main branch — Open" />

      {/* online boolean → success / danger, uppercase marquee style */}
      <div style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}>
        <StatusIndicator online pulse uppercase label="North site — Open" />
        <StatusIndicator online={false} uppercase label="South site — Closed" />
      </div>

      {/* Every tone */}
      <div style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}>
        <StatusIndicator tone="success" pulse label="Operational" />
        <StatusIndicator tone="info" pulse label="Deploying" />
        <StatusIndicator tone="warning" pulse label="Degraded" />
        <StatusIndicator tone="danger" label="Offline" />
        <StatusIndicator tone="neutral" label="Unknown" />
      </div>
    </div>
  );
}
