// example-start
import { createSignal } from "solid-js";
import { Button } from "@kserp/host-ui";
import { ClientPicker, type ClientOption } from "@kahitsan/ksui";

export default function ClientPickerBasic() {
  // In the app the ClientPicker is a labeled field inside the transaction
  // modal. It brings its own trigger button, so we wrap it like a real form
  // field and add a host Button to reset the choice.
  const [selected, setSelected] = createSignal<ClientOption | null>(null);
  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1rem",
      }}
    >
      <div>
        <label class="block text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Billed to
        </label>
        <ClientPicker selected={selected()} onChange={setSelected} />
      </div>

      <div class="flex items-center justify-between gap-3">
        <span class="text-sm text-zinc-400">
          Selected: <span class="text-zinc-100">{selected()?.name_raw ?? "Walk-in"}</span>
        </span>
        <Button
          intent="danger"
          variant="ghost"
          disabled={!selected()}
          onClick={() => setSelected(null)}
        >
          Reset to walk-in
        </Button>
      </div>
    </div>
  );
}
