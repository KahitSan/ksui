// example-start
import { DetailRow } from "@kahitsan/ksui";

export default function DetailRowBasic() {
  // DetailRow lays out one read-only field: a small muted label above its
  // value. When the value is empty it shows an em-dash placeholder, so a
  // record with missing fields still lines up cleanly.
  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "grid",
        "grid-template-columns": "repeat(2, minmax(0, 1fr))",
        gap: "1.25rem",
      }}
    >
      <DetailRow label="Client name" value="Maria Santos" />
      <DetailRow label="Email" value="maria.santos@example.com" />
      <DetailRow label="Phone" value="+63 917 555 0142" />
      <DetailRow label="Company" value="Sunrise Trading Co." />
      <DetailRow label="Tax ID" value="123-456-789-000" />
      {/* Empty value falls back to the em-dash placeholder. */}
      <DetailRow label="Notes" value={null} />
    </div>
  );
}
