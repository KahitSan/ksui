import { Show, type JSX } from "solid-js";
import ArrowRightLeft from "lucide-solid/icons/arrow-right-left";
import Plus from "lucide-solid/icons/plus";
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

interface AccountTileProps {
  role: "from" | "to";
  account: FinancialAccount | undefined;
  emptyHint: string;
  onEditRequest: () => void;
  tileTestId: string;
  clipClass: string;
}

function AccountTile(p: AccountTileProps): JSX.Element {
  const isFilled = () => !!p.account;
  const isFrom = () => p.role === "from";
  return (
    <button
      type="button"
      data-testid={p.tileTestId}
      onClick={p.onEditRequest}
      class={`group flex flex-1 min-w-0 items-center gap-3 border px-4 py-3 text-left transition-colors cursor-pointer ${p.clipClass}`}
      classList={{
        "border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/10":
          isFilled() && isFrom(),
        "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10":
          isFilled() && !isFrom(),
        "border-dashed border-zinc-700 bg-zinc-900/40 hover:border-amber-500/50 hover:bg-zinc-900/60":
          !isFilled(),
      }}
      aria-label={
        isFilled()
          ? `${isFrom() ? "Source" : "Destination"}: ${p.account!.name} — tap to change`
          : `Select ${isFrom() ? "source" : "destination"} account`
      }
    >
      <Show
        when={p.account}
        keyed
        fallback={
          <span class="flex h-8 w-8 items-center justify-center text-zinc-500">
            <Plus size={18} />
          </span>
        }
      >
        {(a) => (
          <AccountAvatar
            account={a}
            size={28}
            iconClass={isFrom() ? "text-blue-300" : "text-amber-300"}
          />
        )}
      </Show>
      <div class="flex min-w-0 flex-col">
        <span
          class="text-[10px] font-semibold uppercase tracking-widest"
          classList={{
            "text-blue-300": isFilled() && isFrom(),
            "text-amber-300": isFilled() && !isFrom(),
            "text-zinc-500": !isFilled(),
          }}
        >
          {isFrom() ? "From" : "To"}
        </span>
        <Show
          when={p.account}
          keyed
          fallback={
            <span class="text-sm text-zinc-500">{p.emptyHint}</span>
          }
        >
          {(a) => (
            <span class="truncate text-sm font-semibold text-zinc-100">
              {a.name}
            </span>
          )}
        </Show>
      </div>
    </button>
  );
}

export default function TransferAccountsPicker(
  props: TransferAccountsPickerProps
) {
  const sourceMeta = () =>
    props.accounts.find((a) => a.id.toString() === props.sourceAccount);
  const destMeta = () =>
    props.accounts.find((a) => a.id.toString() === props.destAccount);

  const swap = () => {
    const s = props.sourceAccount;
    const d = props.destAccount;
    props.setSourceAccount(d);
    props.setDestAccount(s);
  };

  const bothFilled = () => !!props.sourceAccount && !!props.destAccount;

  return (
    <div class="space-y-3">
      <div class="flex items-stretch gap-2 max-sm:flex-col sm:flex-row">
        <AccountTile
          role="from"
          account={sourceMeta()}
          emptyHint="Select source"
          onEditRequest={() => props.setSourceAccount("")}
          tileTestId="transactions-form-transfer-tile-from"
          clipClass="ks-hud-clip-top-right-bottom-left"
        />

        <Show
          when={!bothFilled()}
          fallback={
            <button
              type="button"
              data-testid="transactions-form-transfer-swap"
              onClick={swap}
              class="flex h-9 w-9 shrink-0 items-center justify-center self-center border border-zinc-700 bg-zinc-900 text-zinc-300 transition-colors hover:border-amber-500/60 hover:text-amber-300 cursor-pointer ks-hud-clip-button max-sm:rotate-90"
              aria-label="Swap source and destination"
              title="Swap source and destination"
            >
              <ArrowRightLeft size={14} />
            </button>
          }
        >
          <div
            class="flex shrink-0 items-center justify-center self-center max-sm:h-6 max-sm:w-full sm:h-9 sm:w-14"
            aria-hidden="true"
          >
            <div class="max-sm:hidden sm:block h-4 w-full fin-flow-arrow" />
            <div class="max-sm:block sm:hidden h-6 w-4 fin-flow-arrow-vertical" />
          </div>
        </Show>

        <AccountTile
          role="to"
          account={destMeta()}
          emptyHint={
            props.sourceAccount ? "Select destination" : "Destination"
          }
          onEditRequest={() => props.setDestAccount("")}
          tileTestId="transactions-form-transfer-tile-to"
          clipClass="ks-hud-clip-top-left-bottom-right"
        />
      </div>

      <Show when={!props.sourceAccount}>
        <div
          class="animate-[fin-slide-fade-down_0.28s_ease-out]"
          data-testid="transactions-form-transfer-source-picker"
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
