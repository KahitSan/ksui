// example-start
import { SecretReveal } from "@kahitsan/ksui";

export default function SecretRevealBasic() {
  // SecretReveal is a "save this now" callout. The caller decides when to
  // mount it (usually wrapped in a Show after the secret comes back once).
  // Here we just show it directly with a fake key so you can see the box,
  // the monospace value, and the Copy button.
  const fakeSecret = "ksk_live_8f3a9c21d7b64e05 a1c2b3d4e5f60718".replace(/\s/g, "");

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
      <SecretReveal
        secret={fakeSecret}
        caption="Key for: agentic-laptop"
      />

      <SecretReveal
        secret="tok_2f7Kq9Lz0PmW4Rx8"
        warning="Copy this token before you close the dialog."
      />
    </div>
  );
}
