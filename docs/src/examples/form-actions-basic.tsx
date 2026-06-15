// example-start
import { createSignal } from "solid-js";
import { FormActions } from "@kahitsan/ksui";

export default function FormActionsBasic() {
  const [lastAction, setLastAction] = createSignal("nothing yet");
  const [saving, setSaving] = createSignal(false);

  // Fake a save that takes a moment, so you can see the submit button
  // disable itself while the request is in flight.
  const handleSubmit = () => {
    setLastAction("submit clicked");
    setSaving(true);
    setTimeout(() => setSaving(false), 1200);
  };

  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1.5rem",
      }}
    >
      <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
        <span style={{ "font-size": "0.85rem", opacity: 0.8 }}>Default footer (Save / Cancel)</span>
        <FormActions
          onCancel={() => setLastAction("cancel clicked")}
          onSubmit={handleSubmit}
          submitting={saving()}
        />
      </div>

      <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
        <span style={{ "font-size": "0.85rem", opacity: 0.8 }}>Custom labels</span>
        <FormActions
          onCancel={() => setLastAction("discard clicked")}
          onSubmit={() => setLastAction("create client clicked")}
          cancelLabel="Discard"
          submitLabel="Create client"
        />
      </div>

      <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
        <span style={{ "font-size": "0.85rem", opacity: 0.8 }}>Danger tone</span>
        <FormActions
          onCancel={() => setLastAction("keep clicked")}
          onSubmit={() => setLastAction("delete clicked")}
          cancelLabel="Keep"
          submitLabel="Delete forever"
          danger
        />
      </div>

      <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
        <span style={{ "font-size": "0.85rem", opacity: 0.8 }}>Submit disabled (invalid form)</span>
        <FormActions
          onCancel={() => setLastAction("cancel clicked")}
          onSubmit={() => setLastAction("save clicked")}
          submitDisabled
        />
      </div>

      <p style={{ "font-size": "0.85rem", margin: 0 }}>
        Last action: <strong>{lastAction()}</strong>
      </p>
    </div>
  );
}
