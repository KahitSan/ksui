import X from "lucide-solid/icons/x";

export interface TransferFeeChipProps {
  enabled: boolean;
  onToggle: () => void;
}

export default function TransferFeeChip(props: TransferFeeChipProps) {
  return (
    <button
      type="button"
      data-testid="transactions-form-transfer-fee-toggle"
      onClick={props.onToggle}
      class="flex items-center gap-1.5 self-center rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors cursor-pointer"
      classList={{
        "border-blue-500/50 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25":
          props.enabled,
        "border-zinc-700 bg-zinc-950/60 text-zinc-400 hover:border-blue-500/40 hover:text-blue-300":
          !props.enabled,
      }}
      aria-pressed={props.enabled}
      aria-label={props.enabled ? "Remove transfer fee" : "Add transfer fee"}
    >
      <span>Fees</span>
      <span
        class="inline-flex items-center justify-center"
        classList={{ hidden: !props.enabled }}
        aria-hidden="true"
      >
        <X size={11} />
      </span>
    </button>
  );
}
