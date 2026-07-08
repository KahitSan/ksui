// Create/edit transaction form lifecycle for the /transactions screen.
// Extracted verbatim from index.tsx. Owns every form* signal, the
// isFormBackdated memo, resetForm/populateForm, and the
// handleCreate/handleUpdate submit handlers (attachment upload itself is the
// shared @kahitsan/ksui uploadPendingFiles, also used by counter + timesheets).
//
// The handlers close over nothing from Component(): the cross-cutting
// callbacks/accessors they need (canBackdate, the category/status filter
// accessors+setters, resetAndRefetch trigger, reloadSubcategoryCounts,
// openDetail for handleUpdate's post-save reopen, setEditing, closeCreate) are
// threaded in via the deps object. Behavior is byte-for-byte identical to the
// inline version — same /api/transactions vs /charge branch, same body field
// assembly, same validation guards and error strings, same PUT /visibility
// follow-up, same failed-upload messaging.

import { createMemo, createSignal } from "solid-js";
import { type SalesLine, type ClientOption, type VoucherOption } from "@kahitsan/ksui";
import { todayManila } from "../lib/format";
import {
  type PendingFile,
  revokePendingFile,
  uploadPendingFiles,
} from "@kahitsan/ksui";
import {
  type Transaction,
} from "../lib/types";

export interface TransactionFormDeps {
  canBackdate: () => boolean;
  activeCategories: () => Set<string>;
  setActiveCategories: (next: Set<string>) => void;
  statusFilter: () => string;
  setStatusFilter: (next: string) => void;
  resetAndRefetch: () => void;
  reloadSubcategoryCounts: () => Promise<void>;
  openDetail: (id: number) => Promise<void>;
  setEditing: (next: boolean) => void;
  closeCreate: () => void;
}

export function useTransactionForm(deps: TransactionFormDeps) {
  const {
    canBackdate,
    activeCategories,
    setActiveCategories,
    statusFilter,
    setStatusFilter,
    resetAndRefetch,
    reloadSubcategoryCounts,
    openDetail,
    setEditing,
    closeCreate,
  } = deps;

  // Form state.
  const [formCategory, setFormCategory] = createSignal("expense");
  const [formSourceAccount, setFormSourceAccount] = createSignal("");
  const [formDestAccount, setFormDestAccount] = createSignal("");
  const [formAmount, setFormAmount] = createSignal("");
  const [formDescription, setFormDescription] = createSignal("");
  const [formNotes, setFormNotes] = createSignal("");
  const [formDate, setFormDate] = createSignal(todayManila());
  const [formPrivate, setFormPrivate] = createSignal(false);
  const [formSharedWith, setFormSharedWith] = createSignal<string[]>([]);
  const [formSharedWithRoles, setFormSharedWithRoles] = createSignal<string[]>(
    []
  );
  const [formBackdateReason, setFormBackdateReason] = createSignal("");
  const [formPayee, setFormPayee] = createSignal("");
  const [formPayeeId, setFormPayeeId] = createSignal<number | null>(null);
  const [formRefNumber, setFormRefNumber] = createSignal("");
  const [formTaxType, setFormTaxType] = createSignal("vat_inclusive");
  const [formHasEwt, setFormHasEwt] = createSignal(false);
  const [formEwtRate, setFormEwtRate] = createSignal("1");
  const [formPayableKind, setFormPayableKind] = createSignal("subscription");
  const [formDueDate, setFormDueDate] = createSignal("");
  const [formChequeNumber, setFormChequeNumber] = createSignal("");
  const [formPdcStatus, setFormPdcStatus] = createSignal("issued");
  const [formTransferFeeEnabled, setFormTransferFeeEnabled] =
    createSignal(false);
  const [formTransferFeeAmount, setFormTransferFeeAmount] = createSignal("");
  const [formSubcategory, setFormSubcategory] = createSignal("");
  const [formPendingFiles, setFormPendingFiles] = createSignal<PendingFile[]>(
    []
  );
  const [formSaleItems, setFormSaleItems] = createSignal<SalesLine[]>([]);
  const [formSaleClient, setFormSaleClient] = createSignal<ClientOption | null>(
    null
  );
  const [formSaleVoucher, setFormSaleVoucher] =
    createSignal<VoucherOption | null>(null);
  const [formSaleDiscount, setFormSaleDiscount] = createSignal("");
  const [formSaving, setFormSaving] = createSignal(false);
  const [formError, setFormError] = createSignal("");

  const isFormBackdated = createMemo(() => formDate() !== todayManila());

  function resetForm() {
    setFormCategory("expense");
    setFormSourceAccount("");
    setFormDestAccount("");
    setFormAmount("");
    setFormDescription("");
    setFormNotes("");
    setFormDate(todayManila());
    setFormPrivate(false);
    setFormSharedWith([]);
    setFormSharedWithRoles([]);
    setFormBackdateReason("");
    setFormPayee("");
    setFormPayeeId(null);
    setFormRefNumber("");
    setFormTaxType("vat_inclusive");
    setFormHasEwt(false);
    setFormEwtRate("1");
    setFormPayableKind("subscription");
    setFormDueDate("");
    setFormChequeNumber("");
    setFormPdcStatus("issued");
    setFormTransferFeeEnabled(false);
    setFormTransferFeeAmount("");
    setFormSubcategory("");
    setFormSaleItems([]);
    setFormSaleClient(null);
    setFormSaleVoucher(null);
    setFormSaleDiscount("");
    formPendingFiles().forEach(revokePendingFile);
    setFormPendingFiles([]);
    setFormError("");
  }

  function populateForm(t: Transaction) {
    setFormCategory(t.category);
    setFormSourceAccount(t.source_account_id?.toString() || "");
    setFormDestAccount(t.destination_account_id?.toString() || "");
    setFormAmount(t.amount);
    setFormDescription(t.description);
    setFormNotes(t.notes || "");
    const datePart = t.transaction_date.includes("T")
      ? t.transaction_date.split("T")[0]
      : t.transaction_date;
    setFormDate(datePart);
    setFormPrivate(t.is_private);
    setFormSharedWith(t.shared_with?.map((s) => s.user_id) || []);
    setFormSharedWithRoles(t.shared_with_roles?.map((r) => r.role_code) || []);
    setFormBackdateReason(t.backdate_reason || "");
    setFormPayee(t.payee || "");
    setFormPayeeId(t.payee_id ?? null);
    setFormRefNumber(t.reference_number || "");
    setFormTaxType(t.tax_type || "vat_inclusive");
    setFormHasEwt(!!t.has_ewt);
    setFormEwtRate(t.ewt_rate ?? "1");
    setFormPayableKind(t.payable_kind || "subscription");
    const dueDatePart = t.due_date
      ? t.due_date.includes("T")
        ? t.due_date.split("T")[0]
        : t.due_date
      : "";
    setFormDueDate(dueDatePart);
    setFormChequeNumber(t.cheque_number || "");
    setFormPdcStatus(t.pdc_status || "issued");
    const feeAmountRaw = t.transfer_fee_amount;
    const hasFee =
      t.category === "business" &&
      feeAmountRaw != null &&
      String(feeAmountRaw) !== "" &&
      parseFloat(String(feeAmountRaw)) > 0;
    setFormTransferFeeEnabled(hasFee);
    setFormTransferFeeAmount(hasFee ? String(feeAmountRaw) : "");
    setFormSubcategory(t.subcategory || "");
    const seededSale: SalesLine[] = (t.line_items ?? []).map((li) => ({
      key: `${li.package_id ?? 0}:${li.package_variant_id ?? 0}`,
      package_id: li.package_id ?? 0,
      package_name: li.package_name ?? li.description,
      variant_id: li.package_variant_id ?? 0,
      variant_name: li.variant_name ?? "",
      duration_value: parseFloat(li.duration_value),
      duration_unit: li.duration_unit,
      unit_price: parseFloat(li.unit_price),
      quantity: li.quantity,
    }));
    setFormSaleItems(seededSale);
    setFormSaleClient(
      t.client_id != null
        ? ({
            id: t.client_id,
            name_raw: t.client_name ?? "Unknown",
          } as ClientOption)
        : null
    );
    setFormSaleVoucher(
      t.voucher
        ? ({
            id: t.voucher.id,
            code: t.voucher.code,
            type: t.voucher.type,
            value: t.voucher.value,
            max_discount_amount: null,
            applicable_packages: null,
            minimum_purchase: null,
          } as unknown as VoucherOption)
        : null
    );
    setFormSaleDiscount(
      t.voucher == null &&
        t.discount_amount &&
        parseFloat(t.discount_amount) > 0
        ? t.discount_amount
        : ""
    );
    formPendingFiles().forEach(revokePendingFile);
    setFormPendingFiles([]);
    setFormError("");
  }

  async function handleCreate() {
    if (!formDescription().trim()) {
      setFormError("Description is required");
      return;
    }
    const isSaleWithItems =
      formCategory() === "sale" && formSaleItems().length > 0;
    const createAmt = parseFloat(formAmount());
    const transferFeeAmount = parseFloat(formTransferFeeAmount());
    if (
      !isSaleWithItems &&
      (!formAmount() || !Number.isFinite(createAmt) || createAmt <= 0)
    ) {
      setFormError("Amount must be greater than 0");
      return;
    }
    if (
      formCategory() === "business" &&
      formTransferFeeEnabled() &&
      (!formTransferFeeAmount() ||
        !Number.isFinite(transferFeeAmount) ||
        transferFeeAmount <= 0)
    ) {
      setFormError("Transfer fee amount must be greater than 0");
      return;
    }
    if (isFormBackdated() && !canBackdate()) {
      setFormError("You don't have permission to backdate transactions");
      return;
    }
    if (isFormBackdated() && !formBackdateReason().trim()) {
      setFormError("Reason is required when backdating");
      return;
    }

    setFormSaving(true);
    setFormError("");
    try {
      const isPayable = formCategory() === "payable";
      const manualDiscountNumber = parseFloat(formSaleDiscount());
      // The plugin's POST / route handles manual income/expense/business/payable.
      // Sales WITH a package cart go through POST /charge (the RPC path the
      // server already implements); manual sales (no items) ride POST /.
      let res: Response;
      if (isSaleWithItems) {
        res = await fetch("/api/transactions/charge", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transaction_date: formDate(),
            description: formDescription().trim(),
            notes: formNotes().trim() || null,
            destination_account_id: formDestAccount()
              ? parseInt(formDestAccount())
              : null,
            client_id: formSaleClient()?.id ?? null,
            voucher_id: formSaleVoucher()?.id ?? null,
            discount_amount:
              !formSaleVoucher() &&
              Number.isFinite(manualDiscountNumber) &&
              manualDiscountNumber > 0
                ? manualDiscountNumber
                : 0,
            items: formSaleItems().map((line) => ({
              package_id: line.package_id,
              package_variant_id: line.variant_id,
              description: `${line.package_name} — ${line.variant_name}`,
              quantity: line.quantity,
              unit_price: line.unit_price,
              duration_value: line.duration_value,
              duration_unit: line.duration_unit,
              client_id: null,
            })),
          }),
        });
      } else {
        res = await fetch("/api/transactions", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: formCategory(),
            subcategory: formSubcategory().trim() || null,
            source_account_id: formSourceAccount()
              ? parseInt(formSourceAccount())
              : null,
            destination_account_id: formDestAccount()
              ? parseInt(formDestAccount())
              : null,
            amount: formAmount(),
            description: formDescription().trim(),
            notes: formNotes().trim() || null,
            transaction_date: formDate(),
            is_private: formPrivate(),
            shared_with: formPrivate() ? formSharedWith() : [],
            shared_with_roles: formPrivate() ? formSharedWithRoles() : [],
            backdate_reason: isFormBackdated()
              ? formBackdateReason().trim()
              : null,
            payee: formPayee().trim() || null,
            payee_id: formPayeeId(),
            reference_number: formRefNumber().trim() || null,
            tax_type: formTaxType(),
            has_ewt: formHasEwt(),
            ewt_rate: formHasEwt() ? formEwtRate() : null,
            payable_kind: isPayable ? formPayableKind() : null,
            due_date: isPayable ? formDueDate() || null : null,
            cheque_number: isPayable ? formChequeNumber().trim() || null : null,
            pdc_status:
              isPayable && formChequeNumber().trim() ? formPdcStatus() : null,
            transfer_fee_amount:
              formCategory() === "business" && formTransferFeeEnabled()
                ? formTransferFeeAmount()
                : null,
            client_id: formSaleClient()?.id ?? null,
          }),
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFormError(err.error || "Failed to create transaction");
        return;
      }
      const created = await res.json();
      const createdId =
        created.id ?? created.transaction_id ?? created.transaction?.id;

      let failedNames: string[] = [];
      if (createdId && formPendingFiles().length > 0) {
        failedNames = await uploadPendingFiles(createdId, formPendingFiles());
      }
      if (failedNames.length > 0) {
        setFormError(
          `Transaction saved, but some files didn't upload: ${failedNames.join(
            ", "
          )}. Open the transaction to retry.`
        );
      } else {
        closeCreate();
      }
      const cats = activeCategories();
      const createdCats = Array.isArray(created.created_categories)
        ? created.created_categories.filter(
            (cat: unknown): cat is string => typeof cat === "string"
          )
        : [created.category ?? "sale"];
      if (cats.size > 0 && createdCats.some((cat: string) => !cats.has(cat)))
        setActiveCategories(new Set<string>());
      if (statusFilter() === "voided") setStatusFilter("active");
      resetAndRefetch();
      void reloadSubcategoryCounts();
    } catch {
      setFormError("Network error");
    } finally {
      setFormSaving(false);
    }
  }

  async function handleUpdate(detailTxn: Transaction | null) {
    const t = detailTxn;
    if (!t) return;
    if (!formDescription().trim()) {
      setFormError("Description is required");
      return;
    }
    const isSaleWithItems =
      formCategory() === "sale" && formSaleItems().length > 0;
    const updateAmt = parseFloat(formAmount());
    if (
      !isSaleWithItems &&
      (!formAmount() || !Number.isFinite(updateAmt) || updateAmt <= 0)
    ) {
      setFormError("Amount must be greater than 0");
      return;
    }

    setFormSaving(true);
    setFormError("");
    try {
      const isPayable = formCategory() === "payable";
      const manualDiscountNumber = parseFloat(formSaleDiscount());
      // Send the full field set so an edit persists every detail the create
      // form captured — payee, tax, EWT, payable fields, privacy, backdate
      // reason. Sales with line items carry the full cart so the parent +
      // line items + voucher delta + billed-to client commit together.
      const body: Record<string, unknown> = {
        category: formCategory(),
        subcategory: formSubcategory().trim() || null,
        source_account_id: formSourceAccount()
          ? parseInt(formSourceAccount())
          : null,
        destination_account_id: formDestAccount()
          ? parseInt(formDestAccount())
          : null,
        amount: formAmount(),
        description: formDescription().trim(),
        notes: formNotes().trim() || null,
        transaction_date: formDate(),
        is_private: formPrivate(),
        backdate_reason: isFormBackdated() ? formBackdateReason().trim() : null,
        payee: formPayee().trim() || null,
        payee_id: formPayeeId(),
        reference_number: formRefNumber().trim() || null,
        tax_type: formTaxType(),
        has_ewt: formHasEwt(),
        ewt_rate: formHasEwt() ? formEwtRate() : null,
        payable_kind: isPayable ? formPayableKind() : null,
        due_date: isPayable ? formDueDate() || null : null,
        cheque_number: isPayable ? formChequeNumber().trim() || null : null,
        pdc_status:
          isPayable && formChequeNumber().trim() ? formPdcStatus() : null,
        transfer_fee_amount:
          formCategory() === "business" && formTransferFeeEnabled()
            ? formTransferFeeAmount()
            : null,
      };
      if (isSaleWithItems) {
        body.items = formSaleItems().map((line) => ({
          package_id: line.package_id,
          package_variant_id: line.variant_id,
          description: `${line.package_name} — ${line.variant_name}`,
          quantity: line.quantity,
          unit_price: line.unit_price,
          duration_value: line.duration_value,
          duration_unit: line.duration_unit,
          client_id: null,
        }));
        body.client_id = formSaleClient()?.id ?? null;
        body.voucher_id = formSaleVoucher()?.id ?? null;
        body.discount_amount =
          !formSaleVoucher() &&
          Number.isFinite(manualDiscountNumber) &&
          manualDiscountNumber > 0
            ? manualDiscountNumber
            : 0;
      }
      const res = await fetch(`/api/transactions/${t.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFormError(err.error || "Failed to update transaction");
        return;
      }
      // Persist share-list changes when private.
      if (formPrivate()) {
        await fetch(`/api/transactions/${t.id}/visibility`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            is_private: true,
            shared_with: formSharedWith(),
            shared_with_roles: formSharedWithRoles(),
          }),
        });
      }
      let failedNames: string[] = [];
      if (formPendingFiles().length > 0) {
        failedNames = await uploadPendingFiles(t.id, formPendingFiles());
        const landed = formPendingFiles();
        landed.forEach(revokePendingFile);
        setFormPendingFiles([]);
      }
      if (failedNames.length > 0) {
        setFormError(
          `Saved, but some files didn't upload: ${failedNames.join(
            ", "
          )}. Open the transaction to retry.`
        );
        resetAndRefetch();
        void reloadSubcategoryCounts();
        return;
      }
      await openDetail(t.id);
      setEditing(false);
      resetAndRefetch();
      void reloadSubcategoryCounts();
    } catch {
      setFormError("Network error");
    } finally {
      setFormSaving(false);
    }
  }

  return {
    formCategory,
    setFormCategory,
    formSourceAccount,
    setFormSourceAccount,
    formDestAccount,
    setFormDestAccount,
    formAmount,
    setFormAmount,
    formDescription,
    setFormDescription,
    formNotes,
    setFormNotes,
    formDate,
    setFormDate,
    formPrivate,
    setFormPrivate,
    formSharedWith,
    setFormSharedWith,
    formSharedWithRoles,
    setFormSharedWithRoles,
    formBackdateReason,
    setFormBackdateReason,
    formPayee,
    setFormPayee,
    formPayeeId,
    setFormPayeeId,
    formRefNumber,
    setFormRefNumber,
    formTaxType,
    setFormTaxType,
    formHasEwt,
    setFormHasEwt,
    formEwtRate,
    setFormEwtRate,
    formPayableKind,
    setFormPayableKind,
    formDueDate,
    setFormDueDate,
    formChequeNumber,
    setFormChequeNumber,
    formPdcStatus,
    setFormPdcStatus,
    formTransferFeeEnabled,
    setFormTransferFeeEnabled,
    formTransferFeeAmount,
    setFormTransferFeeAmount,
    formSubcategory,
    setFormSubcategory,
    formPendingFiles,
    setFormPendingFiles,
    formSaleItems,
    setFormSaleItems,
    formSaleClient,
    setFormSaleClient,
    formSaleVoucher,
    setFormSaleVoucher,
    formSaleDiscount,
    setFormSaleDiscount,
    formSaving,
    setFormSaving,
    formError,
    setFormError,
    isFormBackdated,
    resetForm,
    populateForm,
    uploadPendingFiles,
    handleCreate,
    handleUpdate,
  };
}
