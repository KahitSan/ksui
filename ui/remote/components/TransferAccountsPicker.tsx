import { Show } from "solid-js";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { FormField } from "@kahitsan/ksui";
import AccountPicker from "./AccountPicker";
import { type FinancialAccount } from "../lib/types";

export interface TransferAccountsPickerProps {
  accounts: FinancialAccount[];
  sourceAccount: string;
  setSourceAccount: (v: string) => void;
  destAccount: string;
  setDestAccount: (v: string) => void;
  sourceLabel: string;
  destLabel: string;
}

export default function TransferAccountsPicker(
  props: TransferAccountsPickerProps
) {
  return (
    <div class="space-y-3">
      <div class="flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-1.5 text-[11px] font-semibold uppercase tracking-wider">
        <div
          class="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 transition-colors"
          classList={{
            "bg-blue-500/15 text-blue-300": !!props.sourceAccount,
            "bg-zinc-900/60 text-amber-400 animate-pulse":
              !props.sourceAccount,
          }}
          data-testid="transactions-form-transfer-step-1"
        >
          <span class="text-zinc-500">1.</span>
          <span>{props.sourceAccount ? "From" : "Choose source"}</span>
        </div>
        <ChevronRight
          size={14}
          class="shrink-0 text-zinc-600"
          classList={{
            "text-blue-400 animate-pulse":
              !!props.sourceAccount && !props.destAccount,
          }}
        />
        <div
          class="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 transition-colors"
          classList={{
            "bg-blue-500/15 text-blue-300":
              !!props.sourceAccount && !!props.destAccount,
            "bg-zinc-900/60 text-amber-400 animate-pulse":
              !!props.sourceAccount && !props.destAccount,
            "text-zinc-600": !props.sourceAccount,
          }}
          data-testid="transactions-form-transfer-step-2"
        >
          <span class="text-zinc-500">2.</span>
          <span>
            {props.destAccount
              ? "To"
              : props.sourceAccount
                ? "Choose destination"
                : "Destination"}
          </span>
        </div>
      </div>

      <FormField label={props.sourceLabel}>
        <AccountPicker
          accounts={props.accounts}
          ariaLabel={props.sourceLabel}
          value={props.sourceAccount}
          onChange={props.setSourceAccount}
          excludeId={props.destAccount}
          autoDefault={false}
        />
      </FormField>
      <Show when={props.sourceAccount}>
        <div
          class="animate-[fin-slide-fade-down_0.28s_ease-out]"
          data-testid="transactions-form-transfer-dest-wrap"
        >
          <FormField label={props.destLabel}>
            <AccountPicker
              accounts={props.accounts}
              ariaLabel={props.destLabel}
              value={props.destAccount}
              onChange={props.setDestAccount}
              excludeId={props.sourceAccount}
              autoDefault={false}
            />
          </FormField>
        </div>
      </Show>
    </div>
  );
}
