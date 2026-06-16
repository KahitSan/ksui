// example-start
import { SectionHeading } from "@kahitsan/ksui";

export default function SectionHeadingBasic() {
  // SectionHeading is presentational. The title accepts JSX, so brand-specific
  // styling (like a gradient span) is applied by the caller — the component
  // stays domain-free.
  return (
    <div style={{ padding: "1.5rem", display: "grid", gap: "2.5rem" }}>
      {/* Left aligned with kicker + subtitle */}
      <SectionHeading
        kicker="Pricing & Solutions"
        title={<>Flexible workspaces for focused productivity.</>}
        subtitle="From open collaboration zones to private call booths. 24/7 access with everything you need."
        as="h1"
      />

      {/* Centered with an underline accent */}
      <SectionHeading
        kicker="What we offer"
        title="Services"
        accent
        align="center"
      />

      {/* Right aligned, no kicker, custom accent color */}
      <SectionHeading
        title="Spaces"
        subtitle="Designed for deep work."
        accent
        accentClass="bg-blue-500"
        align="right"
      />
    </div>
  );
}
