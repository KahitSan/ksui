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
        "border-[rgba(59,130,246,0.5)] bg-[rgba(59,130,246,0.15)] text-[#93c5fd] hover:bg-[rgba(59,130,246,0.25)]":
          props.enabled,
        "border-[var(--ks-input-border,#3f3f46)] bg-[rgba(9,9,11,0.6)] text-[var(--ks-fg-muted,#a1a1aa)] hover:border-[rgba(59,130,246,0.4)] hover:text-[#93c5fd]":
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
