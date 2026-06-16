// example-start
import { Button } from "@kahitsan/ksui";
import { Save, Trash2, Settings } from "lucide-solid";

export default function ButtonHudBasic() {
  // Button is a domain-free HUD primitive: pick an intent (color tone) and a
  // variant (shape/effect treatment), pass plain children, and optionally an
  // icon. Nothing domain-specific lives here.
  return (
    <div
      style={{
        padding: "1.5rem",
        background: "#0f172a",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1.25rem",
      }}
    >
      <div style={{ display: "flex", gap: "0.75rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <Button intent="primary" variant="clip1">Primary</Button>
        <Button intent="danger" variant="clip1">Danger</Button>
        <Button intent="secondary" variant="clip1">Secondary</Button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <Button intent="primary" variant="clip1">Clip 1</Button>
        <Button intent="primary" variant="clip2">Clip 2</Button>
        <Button intent="primary" variant="ghost">Ghost</Button>
        <Button intent="primary" variant="link">Link</Button>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <Button intent="primary" icon={(p) => <Save {...p} size={16} />}>Save</Button>
        <Button intent="danger" icon={(p) => <Trash2 {...p} size={16} />} iconPosition="right">
          Delete
        </Button>
        <Button intent="secondary" icon={(p) => <Settings {...p} size={16} />} />
        <Button intent="primary" disabled>Disabled</Button>
      </div>
    </div>
  );
}
