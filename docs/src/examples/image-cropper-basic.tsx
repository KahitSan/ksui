// example-start
import { createSignal, Show } from "solid-js";
import { Button } from "@kserp/host-ui";
import { ImageCropper } from "@kahitsan/ksui";

// ImageCropper works on a real File and is shown inside a Modal. This demo
// fetches a sample photo, wraps it in a File, then opens the cropper. When
// you Apply, the cropped region comes back as a WebP Blob, which we turn
// into a preview URL so you can see the square result.
const SAMPLE_IMAGE = "https://picsum.photos/seed/ksui/480/480";

export default function ImageCropperBasic() {
  const [file, setFile] = createSignal<File | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [preview, setPreview] = createSignal<string>("");

  async function openCropper() {
    setLoading(true);
    try {
      const res = await fetch(SAMPLE_IMAGE);
      const blob = await res.blob();
      setFile(new File([blob], "sample.jpg", { type: blob.type || "image/jpeg" }));
    } finally {
      setLoading(false);
    }
  }

  function handleApply(blob: Blob) {
    // Pretend to save. In a real plugin this is where you upload the blob.
    setBusy(true);
    setTimeout(() => {
      setPreview(URL.createObjectURL(blob));
      setBusy(false);
      setFile(null);
    }, 400);
  }

  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1rem",
        "align-items": "flex-start",
      }}
    >
      <Button intent="primary" variant="clip1" onClick={openCropper} disabled={loading()}>
        {loading() ? "Loading photo…" : "Pick and crop a logo"}
      </Button>

      <Show when={preview()}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem", "align-items": "flex-start" }}>
          <span style={{ "font-size": "0.75rem", opacity: "0.7" }}>Cropped result (1:1 WebP):</span>
          <img
            src={preview()}
            alt="Cropped sample"
            style={{ width: "96px", height: "96px", "border-radius": "0.5rem", "object-fit": "cover" }}
          />
        </div>
      </Show>

      <Show when={file()}>
        {(f) => (
          <ImageCropper
            file={f()}
            outputSize={512}
            title="Crop logo"
            busy={busy()}
            onCancel={() => setFile(null)}
            onApply={handleApply}
          />
        )}
      </Show>
    </div>
  );
}
