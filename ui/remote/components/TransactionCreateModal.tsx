import X from "lucide-solid/icons/x";
import { Modal, Tooltip } from "@kahitsan/ksui";
import TransactionForm from "./TransactionForm";
import { type useTransactionForm } from "../hooks/useTransactionForm";
import {
  type FinancialAccount,
  type OrgMember,
  type ShareableRole,
} from "../lib/types";

type Form = ReturnType<typeof useTransactionForm>;

export interface TransactionCreateModalProps {
  form: Form;
  accounts: FinancialAccount[];
  orgMembers: OrgMember[];
  shareableRoles: ShareableRole[];
  isAdmin: boolean;
  canShare: boolean;
  onClose: () => void;
}

export default function TransactionCreateModal(
  props: TransactionCreateModalProps,
) {
  const f = () => props.form;
  return (
    <Modal variant="sheet" onClose={props.onClose}>
      <div
        class="sm:w-[42rem] lg:w-[48rem] sm:max-w-[calc(100vw-2rem)] flex flex-col max-h-[88vh]"
        data-testid="transactions-create-modal"
      >
        <div class="px-5 sm:px-6 py-3 border-b border-zinc-800/60 flex items-center justify-between gap-3 shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <h2 class="text-base font-semibold text-zinc-100 truncate">
              Record transaction
            </h2>
            <Tooltip
              content="Log a sale, expense, transfer between your own accounts, or a payable. Transfers can carry a fee saved as a separate expense from the source account."
              placement="bottom"
              align="start"
              wrap
            >
              <button
                type="button"
                aria-label="About recording a transaction"
                class="ks-interactive inline-flex items-center justify-center w-5 h-5 rounded border border-zinc-700/60 bg-zinc-800/60 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 transition-colors shrink-0"
              >
                <span
                  class="font-serif italic text-[11px] leading-none"
                  aria-hidden="true"
                >
                  i
                </span>
              </button>
            </Tooltip>
          </div>
          <button
            onClick={props.onClose}
            class="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors ks-hud-clip-button cursor-pointer shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <TransactionForm
          error={f().formError()}
          saving={f().formSaving()}
          category={f().formCategory()}
          setCategory={f().setFormCategory}
          subcategory={f().formSubcategory()}
          setSubcategory={f().setFormSubcategory}
          sourceAccount={f().formSourceAccount()}
          setSourceAccount={f().setFormSourceAccount}
          destAccount={f().formDestAccount()}
          setDestAccount={f().setFormDestAccount}
          amount={f().formAmount()}
          setAmount={f().setFormAmount}
          description={f().formDescription()}
          setDescription={f().setFormDescription}
          notes={f().formNotes()}
          setNotes={f().setFormNotes}
          date={f().formDate()}
          setDate={f().setFormDate}
          isPrivate={f().formPrivate()}
          setIsPrivate={f().setFormPrivate}
          sharedWith={f().formSharedWith()}
          setSharedWith={f().setFormSharedWith}
          sharedRoleCodes={f().formSharedWithRoles()}
          setSharedRoleCodes={f().setFormSharedWithRoles}
          backdateReason={f().formBackdateReason()}
          setBackdateReason={f().setFormBackdateReason}
          payee={f().formPayee()}
          setPayee={f().setFormPayee}
          payeeId={f().formPayeeId()}
          setPayeeId={f().setFormPayeeId}
          refNumber={f().formRefNumber()}
          setRefNumber={f().setFormRefNumber}
          taxType={f().formTaxType()}
          setTaxType={f().setFormTaxType}
          hasEwt={f().formHasEwt()}
          setHasEwt={f().setFormHasEwt}
          ewtRate={f().formEwtRate()}
          setEwtRate={f().setFormEwtRate}
          payableKind={f().formPayableKind()}
          setPayableKind={f().setFormPayableKind}
          dueDate={f().formDueDate()}
          setDueDate={f().setFormDueDate}
          chequeNumber={f().formChequeNumber()}
          setChequeNumber={f().setFormChequeNumber}
          pdcStatus={f().formPdcStatus()}
          setPdcStatus={f().setFormPdcStatus}
          transferFeeEnabled={f().formTransferFeeEnabled()}
          setTransferFeeEnabled={f().setFormTransferFeeEnabled}
          transferFeeAmount={f().formTransferFeeAmount()}
          setTransferFeeAmount={f().setFormTransferFeeAmount}
          allowTransferFee={true}
          pendingFiles={f().formPendingFiles()}
          setPendingFiles={f().setFormPendingFiles}
          accounts={props.accounts}
          orgMembers={props.orgMembers}
          shareableRoles={props.shareableRoles}
          isAdmin={props.isAdmin}
          canShare={props.canShare}
          isBackdated={f().isFormBackdated()}
          saleItems={f().formSaleItems()}
          setSaleItems={f().setFormSaleItems}
          saleClient={f().formSaleClient()}
          setSaleClient={f().setFormSaleClient}
          saleVoucher={f().formSaleVoucher()}
          setSaleVoucher={f().setFormSaleVoucher}
          saleManualDiscount={f().formSaleDiscount()}
          setSaleManualDiscount={f().setFormSaleDiscount}
          onSubmit={f().handleCreate}
          submitLabel="Create Transaction"
        />
      </div>
    </Modal>
  );
}
