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
  editTestId: string;
  tileTestId: string;
}

function AccountTile(p: AccountTileProps): JSX.Element {
  const isFilled = () => !!p.account;
  return (
    <button
      type="button"
      data-testid={p.tileTestId}
      onClick={p.onEditRequest}
      class="group flex flex-1 min-w-0 flex-col items-start gap-2 rounded-xl border px-4 py-3 text-left transition-all cursor-pointer"
      classList={{
        "border-blue-500/50 bg-blue-500/10 hover:bg-blue-500/15":
          isFilled() && p.role === "from",
        "border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/15":
          isFilled() && p.role === "to",
        "border-dashed border-zinc-700 bg-zinc-900/40 hover:border-amber-500/50 hover:bg-zinc-900/60 animate-pulse":
          !isFilled(),
      }}
      aria-label={
        isFilled()
          ? `${p.role === "from" ? "Source" : "Destination"} account: ${p.account!.name} (tap to change)`
          : `Select ${p.role === "from" ? "source" : "destination"} account`
      }
    >
      <span
        class="text-[10px] font-semibold uppercase tracking-widest"
        classList={{
          "text-blue-300": isFilled() && p.role === "from",
          "text-emerald-300": isFilled() && p.role === "to",
          "text-zinc-500": !isFilled(),
        }}
      >
        {p.role === "from" ? "From" : "To"}
      </span>
      <Show
        when={p.account}
        keyed
        fallback={
          <div class="flex items-center gap-2 text-zinc-500">
            <span class="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-zinc-700 bg-zinc-950/50">
              <Plus size={14} />
            </span>
            <span class="text-sm font-medium">{p.emptyHint}</span>
          </div>
        }
      >
        {(a) => (
          <div class="flex w-full items-center gap-2.5 min-w-0">
            <span
              class="flex h-8 w-8 items-center justify-center rounded-full ring-1"
              classList={{
                "bg-blue-500/20 ring-blue-500/40": p.role === "from",
                "bg-emerald-500/20 ring-emerald-500/40": p.role === "to",
              }}
            >
              <AccountAvatar
                account={a}
                size={18}
                iconClass={
                  p.role === "from" ? "text-blue-200" : "text-emerald-200"
                }
              />
            </span>
            <div class="flex min-w-0 flex-col">
              <span class="truncate text-sm font-semibold text-zinc-100">
                {a.name}
              </span>
              <span
                data-testid={p.editTestId}
                class="text-[10px] font-semibold uppercase tracking-wider text-amber-400 group-hover:text-amber-300"
              >
                Tap to change
              </span>
            </div>
          </div>
        )}
      </Show>
    </button>
  );
}

function FlowArrow(props: { active: boolean; canSwap: boolean; onSwap: () => void }) {
  return (
    <div class="flex flex-col items-center justify-center gap-1 self-center max-sm:flex-row max-sm:py-1 sm:px-1">
      <Show
        when={props.canSwap}
        fallback={
          <div
            class="flex items-center gap-1 text-blue-400 max-sm:flex-row sm:flex-col"
            classList={{ "opacity-40": !props.active }}
            aria-hidden="true"
          >
            <span class="fin-flow-dot-1 h-1.5 w-1.5 rounded-full bg-current" />
            <span class="fin-flow-dot-2 h-1.5 w-1.5 rounded-full bg-current" />
            <span class="fin-flow-dot-3 h-1.5 w-1.5 rounded-full bg-current" />
          </div>
        }
      >
        <button
          type="button"
          data-testid="transactions-form-transfer-swap"
          onClick={props.onSwap}
          class="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 transition-colors hover:border-amber-500/60 hover:text-amber-300 cursor-pointer max-sm:rotate-90"
          aria-label="Swap source and destination"
          title="Swap source and destination"
        >
          <ArrowRightLeft size={14} />
        </button>
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

  const swap = () => {
    const s = props.sourceAccount;
    const d = props.destAccount;
    props.setSourceAccount(d);
    props.setDestAccount(s);
  };

  return (
    <div class="space-y-3">
      <div class="flex items-stretch gap-2 max-sm:flex-col sm:flex-row">
        <AccountTile
          role="from"
          account={sourceMeta()}
          emptyHint="Select source"
          onEditRequest={() => props.setSourceAccount("")}
          editTestId="transactions-form-transfer-source-change"
          tileTestId="transactions-form-transfer-tile-from"
        />
        <FlowArrow
          active={!!props.sourceAccount || !!props.destAccount}
          canSwap={!!props.sourceAccount && !!props.destAccount}
          onSwap={swap}
        />
        <AccountTile
          role="to"
          account={destMeta()}
          emptyHint={
            props.sourceAccount ? "Select destination" : "Destination"
          }
          onEditRequest={() => props.setDestAccount("")}
          editTestId="transactions-form-transfer-dest-change"
          tileTestId="transactions-form-transfer-tile-to"
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
