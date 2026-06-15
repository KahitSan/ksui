// example-start
import { Button } from "@kserp/host-ui";

export default function ButtonBasic() {
  // The real host Button is styled art: amber/red/slate, with a scanline
  // shimmer on hover, clipped HUD corners, a click ripple, and a glow.
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
      <div style={{ display: "flex", gap: "0.75rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <Button intent="primary">Primary</Button>
        <Button intent="danger">Danger</Button>
        <Button intent="secondary">Secondary</Button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <Button intent="primary" variant="clip1">
          Clip 1
        </Button>
        <Button intent="primary" variant="clip2">
          Clip 2
        </Button>
        <Button intent="primary" variant="ghost">
          Ghost
        </Button>
        <Button intent="primary" variant="link">
          Link
        </Button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <Button intent="danger" variant="clip2">
          Delete
        </Button>
        <Button intent="primary" disabled>
          Disabled
        </Button>
      </div>
    </div>
  );
}
