// example-start
import { createSignal } from "solid-js";
import { Button } from "@kserp/host-ui";
import { PayeePicker, type PayeeOption } from "@kahitsan/ksui";

export default function PayeePickerBasic() {
  // In the app the PayeePicker is a labeled field inside a transaction or
  // payroll modal. It brings its own trigger + search popup, searching the
  // sibling payees plugin at /api/payees. Here we wrap it like a real form
  // field. `selectedName` gives a free-text fallback shown in the trigger
  // when nothing is picked yet (handy to pre-fill a likely name).
  const [payee, setPayee] = createSignal<PayeeOption | null>(null);
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
          Paid to
        </label>
        <PayeePicker
          selected={payee()}
          selectedName="Walk-in vendor"
          onChange={setPayee}
          placeholder="Search or add a payee…"
        />
      </div>

      <div class="flex items-center justify-between gap-3">
        <span class="text-sm text-zinc-400">
          Selected: <span class="text-zinc-100">{payee()?.name ?? "— none —"}</span>
        </span>
        <Button intent="danger" variant="ghost" disabled={!payee()} onClick={() => setPayee(null)}>
          Clear
        </Button>
      </div>
    </div>
  );
}
