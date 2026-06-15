// example-start
import { createSignal } from "solid-js";
import { MentionTextarea } from "@kahitsan/ksui";
import { Button } from "@kserp/host-ui";

export default function MentionTextareaBasic() {
  const [value, setValue] = createSignal("");
  const [saved, setSaved] = createSignal("");
  // This is how the field reads in the app: a notes editor where you type @
  // to tag a client, with a Save action below it.
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
      <MentionTextarea
        value={value()}
        setValue={setValue}
        placeholder="Add notes, type @ to tag a client"
        rows={3}
      />

      <div style={{ display: "flex", gap: "0.75rem", "flex-wrap": "wrap", "align-items": "center" }}>
        <Button intent="primary" onClick={() => setSaved(value())} disabled={!value().trim()}>
          Save note
        </Button>
        <Button intent="secondary" variant="ghost" onClick={() => { setValue(""); setSaved(""); }}>
          Clear
        </Button>
      </div>

      <p class="text-sm text-zinc-400" style={{ margin: 0 }}>
        Saved token value: <code class="text-amber-300">{saved() || "(nothing saved yet)"}</code>
      </p>
    </div>
  );
}
