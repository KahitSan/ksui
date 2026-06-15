// example-start
import { FormErrorBanner } from "@kahitsan/ksui";

export default function FormErrorBannerBasic() {
  // The banner is self-guarding: when the message is falsy it renders
  // nothing, so the empty case below shows up as blank space.
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
      <FormErrorBanner message="Please fill in the client name before saving." />

      <FormErrorBanner message="That email is already in use by another account." class="mt-1" />

      {/* A falsy message renders nothing, so nothing appears here. */}
      <FormErrorBanner message={null} />
    </div>
  );
}
