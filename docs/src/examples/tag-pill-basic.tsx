// example-start
import { TagPill } from "@kahitsan/ksui";

export default function TagPillBasic() {
  // TagPill is a tiny neutral zinc chip for tag and category lists. It has no
  // tone, no dot, and no uppercase, which keeps it visually distinct from
  // StatusPill. Reach for StatusPill instead when you need a colored chip.
  const tags = ["Design", "Frontend", "SolidJS", "Documentation", "Internal"];

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
      <div style={{ display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" }}>
        {tags.map((tag) => (
          <TagPill label={tag} />
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <TagPill label="A single tag on its own" />
      </div>
    </div>
  );
}
