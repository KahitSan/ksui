// example-start
import { createSignal } from "solid-js";
import { SegmentedFilter } from "@kahitsan/ksui";

export default function SegmentedFilterBasic() {
  // Bare strings show capitalized, using the value as the label.
  const [status, setStatus] = createSignal("active");

  // Objects let you supply an explicit label that is not capitalized.
  const [bucket, setBucket] = createSignal("today");

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
        <SegmentedFilter
          options={["active", "archived", "all"]}
          value={status()}
          onChange={setStatus}
          testIdPrefix="status-filter"
        />
        <span style={{ "font-size": "0.8rem", opacity: "0.7" }}>Selected: {status()}</span>
      </div>

      <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
        <SegmentedFilter
          options={[
            { value: "today", label: "Today" },
            { value: "this-week", label: "This week" },
            { value: "this-month", label: "This month" },
          ]}
          value={bucket()}
          onChange={setBucket}
          testIdPrefix="bucket-filter"
        />
        <span style={{ "font-size": "0.8rem", opacity: "0.7" }}>Selected: {bucket()}</span>
      </div>
    </div>
  );
}
