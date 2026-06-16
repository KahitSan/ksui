// example-start
import { createSignal, Show } from "solid-js";
import { Button } from "@kahitsan/ksui";
import { CameraCapture } from "@kahitsan/ksui";

export default function CameraCaptureBasic() {
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal<string | null>(null);
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "0.75rem", "align-items": "flex-start" }}>
      <Button intent="primary" onClick={() => setOpen(true)}>
        Open camera
      </Button>
      <Show when={name()}>
        <p class="text-sm text-zinc-400" style={{ margin: 0 }}>
          Captured: {name()}
        </p>
      </Show>
      <Show when={open()}>
        <CameraCapture
          onCapture={(file) => {
            setName(file.name);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      </Show>
    </div>
  );
}
