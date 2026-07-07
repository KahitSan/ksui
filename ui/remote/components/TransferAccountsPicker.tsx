import { Show } from "solid-js";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { FormField, AccountAvatar } from "@kahitsan/ksui";
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
  const sourceMeta = () =>
    props.accounts.find((a) => a.id.toString() === props.sourceAccount);
  const destMeta = () =>
    props.accounts.find((a) => a.id.toString() === props.destAccount);

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

      <Show
        when={!props.sourceAccount}
        fallback={
          <div
            class="animate-[fin-slide-fade-down_0.28s_ease-out] space-y-3"
            data-testid="transactions-form-transfer-step-2-body"
          >
            <div class="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2">
              <div class="flex min-w-0 items-center gap-2 text-sm">
                <span class="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 shrink-0">
                  {props.sourceLabel}
                </span>
                <Show when={sourceMeta()} keyed>
                  {(a) => (
                    <div class="flex min-w-0 items-center gap-1.5">
                      <AccountAvatar
                        account={a}
                        size={20}
                        iconClass="text-blue-300"
                      />
                      <span class="truncate text-zinc-100">{a.name}</span>
                    </div>
                  )}
                </Show>
              </div>
              <button
                type="button"
                data-testid="transactions-form-transfer-source-change"
                onClick={() => {
                  props.setSourceAccount("");
                  props.setDestAccount("");
                }}
                class="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-amber-400 hover:text-amber-300 cursor-pointer"
              >
                Change
              </button>
            </div>
            <Show
              when={props.destAccount}
              fallback={
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
              }
            >
              <div class="flex items-center justify-between gap-3 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2">
                <div class="flex min-w-0 items-center gap-2 text-sm">
                  <span class="text-[10px] font-semibold uppercase tracking-widest text-blue-300 shrink-0">
                    {props.destLabel}
                  </span>
                  <Show when={destMeta()} keyed>
                    {(a) => (
                      <div class="flex min-w-0 items-center gap-1.5">
                        <AccountAvatar
                          account={a}
                          size={20}
                          iconClass="text-blue-200"
                        />
                        <span class="truncate text-blue-100">{a.name}</span>
                      </div>
                    )}
                  </Show>
                </div>
                <button
                  type="button"
                  data-testid="transactions-form-transfer-dest-change"
                  onClick={() => props.setDestAccount("")}
                  class="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-amber-400 hover:text-amber-300 cursor-pointer"
                >
                  Change
                </button>
              </div>
            </Show>
          </div>
        }
      >
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
      </Show>
    </div>
  );
}
