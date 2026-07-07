import { Show } from "solid-js";
import X from "lucide-solid/icons/x";

export interface TransferFeeChipProps {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  amount: string;
  setAmount: (v: string) => void;
}

export default function TransferFeeChip(props: TransferFeeChipProps) {
  return (
    <Show
      when={props.enabled}
      fallback={
        <button
          type="button"
          data-testid="transactions-form-transfer-fee-toggle"
          onClick={() => props.setEnabled(true)}
          class="self-center rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:border-blue-500/40 hover:text-blue-300 cursor-pointer"
          aria-label="Add transfer fee"
        >
          Fees
        </button>
      }
    >
      <div class="flex items-center gap-1 self-center rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-1 focus-within:border-blue-500/70 transition-colors">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-blue-300">
          Fee ₱
        </span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          data-testid="transactions-form-transfer-fee-amount"
          value={props.amount}
          onInput={(e) => props.setAmount(e.currentTarget.value)}
          class="w-14 min-w-0 bg-transparent text-sm font-semibold tabular-nums text-zinc-100 placeholder-zinc-700 focus:outline-none"
          placeholder="0.00"
        />
        <button
          type="button"
          onClick={() => {
            props.setEnabled(false);
            props.setAmount("");
          }}
          class="rounded p-0.5 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 cursor-pointer"
          aria-label="Remove transfer fee"
        >
          <X size={12} />
        </button>
      </div>
    </Show>
  );
}
