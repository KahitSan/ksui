// example-start
import { createSignal } from "solid-js";
import { Button } from "@kahitsan/ksui";
import { VoucherPicker, calculateDiscount, type VoucherOption } from "@kahitsan/ksui";

export default function VoucherPickerBasic() {
  // In the app the picker sits inside the POS cart panel.
  // It is its own trigger button: click it to open the voucher list, which
  // loads from the sibling vouchers plugin. We show the live subtotal,
  // discount, and total below, plus a host Button to clear the choice.
  const [voucher, setVoucher] = createSignal<VoucherOption | null>(null);
  const subtotal = 1000;
  const discount = () => calculateDiscount(voucher(), subtotal);
  const total = () => subtotal - discount();

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
      <VoucherPicker selected={voucher()} onChange={setVoucher} subtotal={subtotal} packageIds={[]} />

      <div class="text-sm text-zinc-300" style={{ display: "flex", "flex-direction": "column", gap: "0.25rem" }}>
        <div style={{ display: "flex", "justify-content": "space-between" }}>
          <span>Subtotal</span>
          <span class="font-mono">{subtotal}</span>
        </div>
        <div style={{ display: "flex", "justify-content": "space-between" }}>
          <span>Discount</span>
          <span class="font-mono text-emerald-400">-{discount()}</span>
        </div>
        <div style={{ display: "flex", "justify-content": "space-between" }} class="text-zinc-100 font-semibold">
          <span>Total</span>
          <span class="font-mono">{total()}</span>
        </div>
      </div>

      <Button intent="danger" variant="ghost" disabled={!voucher()} onClick={() => setVoucher(null)}>
        Clear voucher
      </Button>
    </div>
  );
}
