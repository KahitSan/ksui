// example-start
import { Button } from "@kserp/host-ui";
import { Tooltip } from "@kahitsan/ksui";

export default function TooltipBasic() {
  // Tooltip is CSS-only. Hover or keyboard-focus the trigger and the bubble
  // fades in above (or below) it. The trigger can be any element.
  return (
    <div
      style={{
        padding: "1.5rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1.75rem",
      }}
    >
      <div style={{ display: "flex", gap: "1.5rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <Tooltip content="Mark this client as the payer">
          <Button intent="primary" variant="clip1">
            Mark as payer
          </Button>
        </Tooltip>

        <Tooltip content="Removes selections; nothing else is lost" placement="bottom">
          <Button intent="secondary" variant="ghost">
            Clear selection
          </Button>
        </Tooltip>
      </div>

      <div style={{ display: "flex", gap: "1.5rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <Tooltip content="Top placement is the default">
          <span style={{ "text-decoration": "underline dotted", cursor: "help" }}>Hover me (top)</span>
        </Tooltip>

        <Tooltip content="This bubble sits below the trigger" placement="bottom">
          <span style={{ "text-decoration": "underline dotted", cursor: "help" }}>Hover me (bottom)</span>
        </Tooltip>
      </div>
    </div>
  );
}
