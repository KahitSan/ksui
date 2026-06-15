// example-start
import { CopyButton } from "@kahitsan/ksui";

export default function CopyButtonBasic() {
  // CopyButton owns its own copied state. Click it, and it writes the text
  // to the clipboard, flips to the "copied" label and a check icon for about
  // 1.5 seconds, then returns to its normal label.
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
        <CopyButton text="ks_live_4f9a2b7c1e8d" />
        <CopyButton text="hello@kahitsan.com" label="Copy email" copiedLabel="Email copied" />
      </div>

      <div style={{ display: "flex", gap: "0.75rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <CopyButton
          text="https://www.hilinga.com/share/abc123"
          label="Copy link"
          copiedLabel="Link copied"
          size={16}
        />
      </div>
    </div>
  );
}
