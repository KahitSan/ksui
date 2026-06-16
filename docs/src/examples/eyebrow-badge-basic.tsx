// example-start
import { EyebrowBadge } from "@kahitsan/ksui";

export default function EyebrowBadgeBasic() {
  // EyebrowBadge is a tiny uppercase, wide-tracked kicker label. The plain
  // variant is just tracked text; the bordered variant wraps it in a tinted
  // pill with a left accent border. The caller supplies the label and tone.
  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1.5rem",
        "align-items": "flex-start",
      }}
    >
      {/* Bordered pill variant — the hero-style kicker. */}
      <EyebrowBadge label="Coworking Space in Naga City" bordered />
      <EyebrowBadge label="System Status" tone="emerald" bordered />

      {/* Plain tracked-text variant at each tracking preset. */}
      <EyebrowBadge label="Trusted by teams" tone="zinc" tracking="wider" />
      <EyebrowBadge label="What we offer" tone="amber" tracking="wide" />
      <EyebrowBadge label="Diversify" tone="blue" />
    </div>
  );
}
