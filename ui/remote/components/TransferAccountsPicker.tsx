import { Show, type JSX } from "solid-js";
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

interface StepColumnProps {
  stepNumber: 1 | 2;
  header: string;
  account: FinancialAccount | undefined;
  active: boolean;
  pulsing: boolean;
  onChange: () => void;
  changeTestId: string;
  stepTestId: string;
  avatarIconClass: string;
  nameClass: string;
}

function StepColumn(p: StepColumnProps): JSX.Element {
  return (
    <div
      class="flex flex-1 min-w-0 flex-col gap-1.5 rounded-md px-3 py-2 transition-colors"
      classList={{
        "bg-blue-500/15": p.active,
        "bg-zinc-900/60": !p.active,
      }}
      data-testid={p.stepTestId}
    >
      <div
        class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
        classList={{
          "text-blue-300": p.active,
          "text-amber-400 animate-pulse": p.pulsing,
          "text-zinc-600": !p.active && !p.pulsing,
        }}
      >
        <span class="text-zinc-500">{p.stepNumber}.</span>
        <span class="truncate">{p.header}</span>
      </div>
      <Show when={p.account} keyed>
        {(a) => (
          <div class="flex items-center justify-between gap-2 min-w-0">
            <div class="flex min-w-0 items-center gap-1.5">
              <AccountAvatar
                account={a}
                size={20}
                iconClass={p.avatarIconClass}
              />
              <span class={`truncate text-sm normal-case tracking-normal ${p.nameClass}`}>
                {a.name}
              </span>
            </div>
            <button
              type="button"
              data-testid={p.changeTestId}
              onClick={p.onChange}
              class="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-amber-400 hover:text-amber-300 cursor-pointer"
            >
              Change
            </button>
          </div>
        )}
      </Show>
    </div>
  );
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
      <div class="flex items-stretch gap-2 rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-1.5">
        <StepColumn
          stepNumber={1}
          header={props.sourceAccount ? "From" : "Choose source"}
          account={sourceMeta()}
          active={!!props.sourceAccount}
          pulsing={!props.sourceAccount}
          onChange={() => {
            props.setSourceAccount("");
            props.setDestAccount("");
          }}
          changeTestId="transactions-form-transfer-source-change"
          stepTestId="transactions-form-transfer-step-1"
          avatarIconClass="text-blue-300"
          nameClass="text-zinc-100"
        />
        <ChevronRight
          size={14}
          class="shrink-0 self-center text-zinc-600"
          classList={{
            "text-blue-400 animate-pulse":
              !!props.sourceAccount && !props.destAccount,
          }}
        />
        <StepColumn
          stepNumber={2}
          header={
            props.destAccount
              ? "To"
              : props.sourceAccount
                ? "Choose destination"
                : "Destination"
          }
          account={destMeta()}
          active={!!props.destAccount}
          pulsing={!!props.sourceAccount && !props.destAccount}
          onChange={() => props.setDestAccount("")}
          changeTestId="transactions-form-transfer-dest-change"
          stepTestId="transactions-form-transfer-step-2"
          avatarIconClass="text-blue-200"
          nameClass="text-blue-100"
        />
      </div>

      <Show when={!props.sourceAccount}>
        <div data-testid="transactions-form-transfer-source-picker">
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
        </div>
      </Show>
      <Show when={props.sourceAccount && !props.destAccount}>
        <div
          class="animate-[fin-slide-fade-down_0.28s_ease-out]"
          data-testid="transactions-form-transfer-dest-picker"
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
