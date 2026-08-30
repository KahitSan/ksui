import { Show } from "solid-js";
import type { PaymentAccountOption } from "./PaymentAccountPicker";
import FormField from "../base/FormField";
import AccountRadioPicker from "./AccountRadioPicker";
import TransferAccountsPicker from "./TransferAccountsPicker";

export type TransactionFormAccount = PaymentAccountOption & {
  balance?: number | string | null;
};

export interface TransactionAccountFieldsProps {
  category: string;
  accounts: TransactionFormAccount[];
  accountLabel: string;
  accountHint: string;
  showSecondAccount: boolean;
  secondAccountLabel?: string;
  sourceAccount: string;
  setSourceAccount: (v: string) => void;
  destAccount: string;
  setDestAccount: (v: string) => void;
  amount: string;
  transferFeeAmount: string;
  transferFeeEnabled: boolean;
  allowTransferFee: boolean;
  compact?: boolean;
}

/**
 * The single-account-picker vs transfer-accounts-picker branch, split out of
 * TransactionForm to keep that file under the file-size budget. `sale` writes
 * to destAccount, every other category writes to sourceAccount — that
 * category-driven single/second-account split is the only domain logic here.
 */
export default function TransactionAccountFields(props: TransactionAccountFieldsProps) {
  return (
    <Show
      when={props.showSecondAccount}
      fallback={
        <FormField label={props.accountLabel}>
          <AccountRadioPicker
            accounts={props.accounts}
            ariaLabel={props.accountLabel}
            value={
              props.category === "sale" ? props.destAccount : props.sourceAccount
            }
            compact={props.compact}
            tone={props.category === "sale" ? "income" : "expense"}
            onChange={(v) => {
              if (props.category === "sale") {
                props.setDestAccount(v);
                props.setSourceAccount("");
              } else {
                props.setSourceAccount(v);
                props.setDestAccount("");
              }
            }}
          />
          <Show when={props.accountHint}>
            <p class="text-[10px] text-[var(--ks-fg-subtle,#71717a)] mt-0.5">
              {props.accountHint}
            </p>
          </Show>
        </FormField>
      }
    >
      <TransferAccountsPicker
        accounts={props.accounts}
        sourceAccount={props.sourceAccount}
        setSourceAccount={props.setSourceAccount}
        destAccount={props.destAccount}
        setDestAccount={props.setDestAccount}
        sourceLabel={props.accountLabel}
        destLabel={props.secondAccountLabel!}
        amount={props.amount}
        feeAmount={props.transferFeeAmount}
        feeEnabled={props.transferFeeEnabled && props.allowTransferFee}
      />
    </Show>
  );
}
