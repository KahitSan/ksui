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
        "border-[color-mix(in_srgb,var(--ks-info,#38bdf8)_50%,transparent)] bg-[color-mix(in_srgb,var(--ks-info,#38bdf8)_15%,transparent)] text-[var(--ks-info-fg,#7dd3fc)] hover:bg-[color-mix(in_srgb,var(--ks-info,#38bdf8)_25%,transparent)]":
          props.enabled,
        "border-[var(--ks-input-border,#3f3f46)] bg-[color-mix(in_srgb,var(--ks-surface,#0f0f0f)_60%,transparent)] text-[var(--ks-fg-muted,#a1a1aa)] hover:border-[color-mix(in_srgb,var(--ks-info,#38bdf8)_40%,transparent)] hover:text-[var(--ks-info-fg,#7dd3fc)]":
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
