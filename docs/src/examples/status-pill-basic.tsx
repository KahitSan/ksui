// example-start
import { StatusPill } from "@kahitsan/ksui";

export default function StatusPillBasic() {
  // StatusPill is a tiny status chip. The caller maps its own domain enum
  // (a transaction status, an is_active flag, a voucher state) to one of the
  // five tones and passes a plain label. Nothing domain-specific lives here.
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
        <StatusPill tone="success" label="Paid" />
        <StatusPill tone="neutral" label="Draft" />
        <StatusPill tone="warning" label="Pending" />
        <StatusPill tone="danger" label="Overdue" />
        <StatusPill tone="info" label="Sent" />
      </div>

      <div style={{ display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <StatusPill tone="success" label="Active" dot />
        <StatusPill tone="neutral" label="Inactive" dot />
        <StatusPill tone="danger" label="Suspended" dot />
      </div>

      <div style={{ display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <StatusPill tone="success" label="Redeemed" solid />
        <StatusPill tone="warning" label="Reserved" solid />
        <StatusPill tone="info" label="Issued" solid dot />
      </div>
    </div>
  );
}
