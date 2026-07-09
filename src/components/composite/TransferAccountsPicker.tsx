import { Show, type JSX } from "solid-js";
import ArrowRightLeft from "lucide-solid/icons/arrow-right-left";
import Plus from "lucide-solid/icons/plus";
import AccountAvatar from "../base/AccountAvatar";
import FormField from "../base/FormField";
import AccountRadioPicker from "./AccountRadioPicker";
import type { TransactionAccount } from "./TransactionForm";
import { formatPHP } from "../../utils/formatPHP";

export interface TransferAccountsPickerProps {
  accounts: TransactionAccount[];
  sourceAccount: string;
  setSourceAccount: (v: string) => void;
  destAccount: string;
  setDestAccount: (v: string) => void;
  sourceLabel: string;
  destLabel: string;
  amount: string;
  feeAmount: string;
  feeEnabled: boolean;
}

interface AccountTileProps {
  role: "from" | "to";
  account: TransactionAccount | undefined;
  emptyHint: string;
  delta: number;
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
        "border-[color-mix(in_srgb,var(--ks-info,#38bdf8)_40%,transparent)] bg-[color-mix(in_srgb,var(--ks-info,#38bdf8)_5%,transparent)] hover:bg-[color-mix(in_srgb,var(--ks-info,#38bdf8)_10%,transparent)]":
          isFilled() && isFrom(),
        "border-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_40%,transparent)] bg-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_5%,transparent)] hover:bg-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_10%,transparent)]":
          isFilled() && !isFrom(),
        "border-dashed border-[var(--ks-input-border,#3f3f46)] bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_40%,transparent)] hover:border-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_50%,transparent)] hover:bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_60%,transparent)]":
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
          <span class="flex h-8 w-8 items-center justify-center text-[var(--ks-fg-subtle,#71717a)]">
            <Plus size={18} />
          </span>
        }
      >
        {(a) => (
          <AccountAvatar
            account={a}
            size={28}
            iconClass={isFrom() ? "text-[var(--ks-info,#38bdf8)]" : "text-[var(--ks-accent-hover,#fcd34d)]"}
          />
        )}
      </Show>
      <div class="flex min-w-0 flex-col">
        <span
          class="text-[10px] font-semibold uppercase tracking-widest"
          classList={{
            "text-[var(--ks-info,#38bdf8)]": isFilled() && isFrom(),
            "text-[var(--ks-accent-hover,#fcd34d)]": isFilled() && !isFrom(),
            "text-[var(--ks-fg-subtle,#71717a)]": !isFilled(),
          }}
        >
          {isFrom() ? "From" : "To"}
        </span>
        <Show
          when={p.account}
          keyed
          fallback={
            <span class="text-sm text-[var(--ks-fg-subtle,#71717a)]">{p.emptyHint}</span>
          }
        >
          {(a) => (
            <>
              <span class="truncate text-sm font-semibold text-[var(--ks-fg,#ffffff)]">
                {a.name}
              </span>
              <Show when={a.balance != null}>
                <span class="flex items-baseline gap-1 text-[11px] tabular-nums text-[var(--ks-fg-muted,#a1a1aa)]">
                  <span class="truncate">{formatPHP(a.balance!)}</span>
                  <Show when={p.delta !== 0}>
                    <span
                      class="whitespace-nowrap font-semibold"
                      classList={{
                        "text-[var(--ks-danger-fg,#f87171)]": p.delta < 0,
                        "text-[var(--ks-success-fg,#34d399)]": p.delta > 0,
                      }}
                      data-testid={`transactions-form-transfer-delta-${p.role}`}
                    >
                      ({p.delta > 0 ? "+" : ""}
                      {formatPHP(p.delta)})
                    </span>
                  </Show>
                </span>
              </Show>
            </>
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

  const amountNum = () => {
    const n = parseFloat(props.amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const feeNum = () => {
    if (!props.feeEnabled) return 0;
    const n = parseFloat(props.feeAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const sourceDelta = () => -(amountNum() + feeNum());
  const destDelta = () => amountNum();

  return (
    <div class="space-y-3">
      <div class="flex items-stretch gap-2 max-sm:flex-col sm:flex-row">
        <AccountTile
          role="from"
          account={sourceMeta()}
          emptyHint="Select source"
          delta={sourceDelta()}
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
              class="flex h-9 w-9 shrink-0 items-center justify-center self-center border border-[var(--ks-input-border,#3f3f46)] bg-[var(--ks-input-bg,#18181b)] text-[var(--ks-fg,#ffffff)] transition-colors hover:border-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_60%,transparent)] hover:text-[var(--ks-accent-hover,#fcd34d)] cursor-pointer ks-hud-clip-button max-sm:rotate-90"
              aria-label="Swap source and destination"
              title="Swap source and destination"
            >
              <ArrowRightLeft size={14} />
            </button>
          }
        >
          <div
            class="shrink-0 self-center max-sm:py-1 sm:px-1"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 56 14"
              class="max-sm:hidden sm:block h-3.5 w-14"
            >
              <defs>
                <linearGradient
                  id="fin-flow-h"
                  gradientUnits="userSpaceOnUse"
                  x1="0"
                  y1="7"
                  x2="56"
                  y2="7"
                >
                  <stop offset="0" style={{ "stop-color": "var(--ks-info, #38bdf8)" }} />
                  <stop offset="1" style={{ "stop-color": "var(--ks-warning, #f59e0b)" }} />
                </linearGradient>
              </defs>
              <line
                x1="0"
                y1="7"
                x2="44"
                y2="7"
                stroke="url(#fin-flow-h)"
                stroke-width="2"
                class="fin-flow-dash"
              />
              <path d="M44 1 L56 7 L44 13 Z" style={{ fill: "var(--ks-warning, #f59e0b)" }} />
            </svg>
            <svg
              viewBox="0 0 14 40"
              class="max-sm:block sm:hidden h-10 w-3.5"
            >
              <defs>
                <linearGradient
                  id="fin-flow-v"
                  gradientUnits="userSpaceOnUse"
                  x1="7"
                  y1="0"
                  x2="7"
                  y2="40"
                >
                  <stop offset="0" style={{ "stop-color": "var(--ks-info, #38bdf8)" }} />
                  <stop offset="1" style={{ "stop-color": "var(--ks-warning, #f59e0b)" }} />
                </linearGradient>
              </defs>
              <line
                x1="7"
                y1="0"
                x2="7"
                y2="30"
                stroke="url(#fin-flow-v)"
                stroke-width="2"
                class="fin-flow-dash"
              />
              <path d="M1 30 L13 30 L7 40 Z" style={{ fill: "var(--ks-warning, #f59e0b)" }} />
            </svg>
          </div>
        </Show>

        <AccountTile
          role="to"
          account={destMeta()}
          emptyHint={
            props.sourceAccount ? "Select destination" : "Destination"
          }
          delta={destDelta()}
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
            <AccountRadioPicker
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
            <AccountRadioPicker
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
