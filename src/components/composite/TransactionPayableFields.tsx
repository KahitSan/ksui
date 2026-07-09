import { For, Show } from "solid-js";
import CalendarDays from "lucide-solid/icons/calendar-days";
import FormField from "../base/FormField";
import DatePicker from "../base/DatePicker";
import SegmentedFilter from "../base/SegmentedFilter";

const PAYABLE_KIND_OPTIONS: { id: string; label: string }[] = [
  { id: "subscription", label: "Subscription" },
  { id: "utility", label: "Utility" },
  { id: "rent", label: "Rent / Lease" },
  { id: "loan", label: "Loan" },
  { id: "tax", label: "Tax" },
  { id: "other", label: "Other" },
];

const PDC_OPTIONS: { id: string; label: string; dot: string }[] = [
  { id: "issued", label: "PDC issued", dot: "bg-[var(--ks-accent,#fbbf24)]" },
  { id: "presented", label: "PDC presented", dot: "bg-[var(--ks-info,#38bdf8)]" },
  { id: "cleared", label: "PDC cleared", dot: "bg-[var(--ks-success-fg,#34d399)]" },
  { id: "bounced", label: "PDC bounced", dot: "bg-[var(--ks-danger-fg,#f87171)]" },
];

export interface TransactionPayableFieldsProps {
  payableKind: string;
  setPayableKind: (v: string) => void;
  dueDate: string;
  setDueDate: (v: string) => void;
  chequeNumber: string;
  setChequeNumber: (v: string) => void;
  pdcStatus: string;
  setPdcStatus: (v: string) => void;
}

// The "payable" category's extra fields, split out of TransactionForm to keep
// that file under the file-size budget. Kind/due-date/cheque/PDC-status only
// ever apply to the payable category, so this stays a pure sub-form.
export default function TransactionPayableFields(props: TransactionPayableFieldsProps) {
  return (
    <div class="rounded-lg border border-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_20%,transparent)] bg-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_5%,transparent)] p-3 space-y-3">
      <div class="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--ks-accent,#fbbf24)] font-semibold">
        <CalendarDays size={12} />
        <span>Payable details</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Kind *">
          <select
            value={props.payableKind}
            onChange={(e) => props.setPayableKind(e.currentTarget.value)}
            class="w-full bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_60%,transparent)] border border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] px-3 py-3 text-sm text-[var(--ks-fg,#ffffff)] ks-hud-clip-button cursor-pointer focus:outline-none focus:border-[color-mix(in_srgb,var(--ks-focus-ring,#c9a961)_50%,transparent)]"
          >
            <For each={PAYABLE_KIND_OPTIONS}>
              {(opt) => <option value={opt.id}>{opt.label}</option>}
            </For>
          </select>
        </FormField>
        <FormField label="Due date">
          <DatePicker
            value={props.dueDate}
            onChange={(d: string | null) => props.setDueDate(d || "")}
          />
          <p class="text-[10px] text-[var(--ks-fg-subtle,#71717a)] mt-0.5">
            When payment is owed. Past-due payables show in the Payables tab.
          </p>
        </FormField>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Cheque number">
          <input
            type="text"
            value={props.chequeNumber}
            onInput={(e) => props.setChequeNumber(e.currentTarget.value)}
            class="w-full bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_60%,transparent)] border border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] px-3 py-3 text-sm text-[var(--ks-fg,#ffffff)] ks-hud-clip-button focus:outline-none focus:border-[color-mix(in_srgb,var(--ks-focus-ring,#c9a961)_50%,transparent)]"
            placeholder="e.g. 0004429-007"
          />
          <p class="text-[10px] text-[var(--ks-fg-subtle,#71717a)] mt-0.5">
            For post-dated cheques (PDC). Leave blank for direct payments.
          </p>
        </FormField>
        <Show when={props.chequeNumber.trim()}>
          <FormField label="PDC status">
            <SegmentedFilter
              options={PDC_OPTIONS.map((opt) => ({
                value: opt.id,
                label: opt.label.replace("PDC ", ""),
              }))}
              value={props.pdcStatus}
              onChange={props.setPdcStatus}
              ariaLabel="PDC status"
            />
          </FormField>
        </Show>
      </div>
    </div>
  );
}
