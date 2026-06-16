// example-start
import { createSignal, Show } from "solid-js";
import { Button, Modal } from "@kahitsan/ksui";

export default function ModalBasic() {
  const [open, setOpen] = createSignal(false);
  const [danger, setDanger] = createSignal(false);
  return (
    <div style={{ display: "flex", gap: "0.75rem", "flex-wrap": "wrap" }}>
      <Button
        onClick={() => {
          setDanger(false);
          setOpen(true);
        }}
      >
        Open modal
      </Button>
      <Button
        intent="danger"
        variant="clip2"
        onClick={() => {
          setDanger(true);
          setOpen(true);
        }}
      >
        Open danger modal
      </Button>
      <Show when={open()}>
        <Modal
          onClose={() => setOpen(false)}
          size="md"
          tone={danger() ? "danger" : "default"}
          ariaLabel="Demo modal"
        >
          <div class="text-zinc-200">
            <h2 class="text-lg font-semibold text-zinc-100" style={{ "margin-top": 0 }}>
              Hello from the modal
            </h2>
            <p>The Modal is caller mounted: wrap it in a Show. Escape, backdrop, or the button close it.</p>
            <Button intent="secondary" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </Modal>
      </Show>
    </div>
  );
}
