// example-start
import { createSignal } from "solid-js";
import { Button } from "@kserp/host-ui";
import { PaymentAccountPicker, type PaymentAccountOption } from "@kahitsan/ksui";

export default function PaymentAccountPickerBasic() {
  // In the app the picker lives inside a charge modal: you pick the account
  // money lands in, then hit Charge. Charge stays disabled until at least one
  // account is loaded, which is what onCountChange reports back up.
  const [account, setAccount] = createSignal<PaymentAccountOption | null>(null);
  const [count, setCount] = createSignal(0);

  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1rem",
        "max-width": "24rem",
      }}
    >
      <PaymentAccountPicker selected={account()} onChange={setAccount} onCountChange={setCount} />

      <div style={{ display: "flex", "justify-content": "flex-end" }}>
        <Button intent="primary" variant="clip1" disabled={count() === 0}>
          Charge
        </Button>
      </div>

      <p class="text-xs text-zinc-500" style={{ margin: 0 }}>
        Accounts loaded: {count()} | Selected: {account()?.name ?? "none"}
      </p>
    </div>
  );
}
