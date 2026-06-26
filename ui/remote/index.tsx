// Remote UI module for the transactions plugin — 1:1 port of the monolith
// /transactions screen (KahitSan/kserp kplugins/transactions/ui/routes/index.tsx),
// adapted for the isolated plugin runtime.
//
// Built to an IIFE the plugin process serves at /_ui; the host loads it at
// runtime and renders <Component/> on its single Solid runtime. solid-js and
// the host UI kit (@kserp/host-ui) are externalized to host globals.
//
// Differences from the monolith, all forced by the fork's surface:
//  - Shared UI (DataTable, PageShell, PageShareButton, Modal, DatePicker,
//    SearchableSelect, Avatar, Button, confirm) + hooks (useActiveWorkspace,
//    permissions) + helpers (highlightMatch) come from "@kserp/host-ui".
//  - No @solidjs/router in the remote, so URL filter-persistence is dropped;
//    filters live in plain signals. No feature-flag Navigate gate.
//  - Cross-plugin pickers (Payee/Client/Voucher/packages/accounts) fetch the
//    sibling plugin's relative API and degrade gracefully when absent.
//  - Subcategory taxonomy lives at /api/transactions/subcategories (the plugin
//    folds the monolith's /api/transaction-subcategories under its basePath).
//  - Attachments are URL-based on the plugin server; uploads POST metadata.

import "./styles.css"; // plugin Tailwind utilities (host injects /_ui/remote.css)
import { createSignal, Show } from "solid-js";

import Plus from "lucide-solid/icons/plus";
import Download from "lucide-solid/icons/download";
import X from "lucide-solid/icons/x";
import Pencil from "lucide-solid/icons/pencil";
import Ban from "lucide-solid/icons/ban";

import TransactionForm from "./components/TransactionForm";
import {
  TransactionDetail,
  TransactionDetailSkeleton,
} from "./components/TransactionDetail";
import PaymentLegModal from "./components/PaymentLegModal";
import { runFlow } from "@kahitsan/plugin-sdk/flow";
import {
  voidFlow,
  deletePaymentFlow,
  deleteAttachmentFlow,
} from "../../server/flows.js";

import ExportTransactionsModal from "./components/ExportTransactionsModal";
import TransactionFilters from "./components/TransactionFilters";
import { useAccountsIndex } from "@kahitsan/ksui";
import { formatDate } from "./lib/format";
import {
  type PendingFile,
  createPendingFile,
  revokePendingFile,
  type Transaction,
  type Attachment,
} from "./lib/types";
import { CATEGORY_STYLES, CATEGORY_TONE, TONE_CLASSES } from "./lib/constants";
import { type TransactionRow, makeAggregatedRow } from "./lib/rows";
import { makeTransactionColumns } from "./components/transactionColumns";
import { useLazyDayGroups } from "./hooks/useLazyDayGroups";
import { useTransactionForm } from "./hooks/useTransactionForm";
import { useTransactionFilters } from "./hooks/useTransactionFilters";
import { useTransactionReferenceData } from "./hooks/useTransactionReferenceData";

import {
  PageShell,
  PageShareButton,
  useActiveWorkspace,
  usePermissions,
  PermissionGate,
} from "@kserp/host-ui";
import {
  Modal,
  DataTable,
  Button,
  confirm,
  type FetchParams,
  type FetchResult,
} from "@kahitsan/ksui";

export function Component() {
  const { activeWorkspace } = useActiveWorkspace();
  const perms = usePermissions();
  const canAccess = () => perms.has("transactions.view");
  const canEdit = () =>
    perms.hasAny("transactions.create", "transactions.edit");
  const accountsIndex = useAccountsIndex();

  const isAdmin = () => perms.has("transactions.delete");
  const canBackdate = () => perms.has("transactions.backdate");
  const canShare = () => perms.hasAny("members.list_basic", "members.view");

  const [groupSalesByDay, setGroupSalesByDay] = createSignal(false);
  let resetAndRefetchFn: (() => void) | undefined;

  const filters = useTransactionFilters({
    resetAndRefetch: () => resetAndRefetchFn?.(),
    groupSalesByDay,
    setGroupSalesByDay,
  });
  const {
    activeCategories,
    setActiveCategories,
    statusFilter,
    setStatusFilter,
    accountFilter,
    setAccountFilter,
    subcategoryFilter,
    setSubcategoryFilter,
    createdByFilter,
    setCreatedByFilter,
    tableSearchTerm,
    setTableSearchTerm,
    pdcFilter,
    setPdcFilter,
    categoryFilterParam,
    activeFilterCount,
    clearAllFilters,
  } = filters;

  const reference = useTransactionReferenceData({
    activeWorkspace,
    canShare,
    activeCategories,
  });
  const {
    accounts,
    orgMembers,
    shareableRoles,
    subcategoryOptions,
    subcategoryCounts,
    creators,
    creatorName,
    peersUnavailable,
    setPeersUnavailable,
    reloadSubcategoryCounts,
    loadOrgMembers,
  } = reference;

  // Detail / create / export modal state.
  const [detailId, setDetailId] = createSignal<number | null>(null);
  const [detailTxn, setDetailTxn] = createSignal<Transaction | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [createOpen, setCreateOpen] = createSignal(false);
  const [exportOpen, setExportOpen] = createSignal(false);
  const [voidConfirm, setVoidConfirm] = createSignal(false);
  const [settleLegWizard, setSettleLegWizard] = createSignal<
    | { txId: number; mode: "list" }
    | { txId: number; mode: "edit-leg"; legId: number }
    | { txId: number; mode: "settle" }
    | null
  >(null);

  const form = useTransactionForm({
    canBackdate,
    activeCategories,
    setActiveCategories,
    statusFilter,
    setStatusFilter,
    resetAndRefetch: () => resetAndRefetchFn?.(),
    reloadSubcategoryCounts,
    openDetail: (id: number) => openDetail(id),
    setEditing,
    closeCreate: () => closeCreate(),
  });
  const {
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
    formError,
    setFormError,
    isFormBackdated,
    resetForm,
    populateForm,
    handleCreate,
  } = form;

  function closeCreate() {
    setCreateOpen(false);
    resetForm();
  }

  function closeDetail() {
    setDetailId(null);
    setDetailTxn(null);
    setEditing(false);
    setVoidConfirm(false);
    setFormError("");
  }

  async function openDetail(id: number) {
    setDetailId(id);
    if (detailTxn()?.id !== id) setDetailTxn(null);
    try {
      const res = await fetch(`/api/transactions/${id}`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (detailId() === id) closeDetail();
        return;
      }
      const data = (await res.json()) as Transaction;
      if (detailId() !== id) return;
      setDetailTxn(data);
      setEditing(false);
    } catch {
      if (detailId() === id) closeDetail();
    }
  }

  function startEdit() {
    const t = detailTxn();
    if (!t) return;
    populateForm(t);
    loadOrgMembers();
    setEditing(true);
  }

  async function handleVoid(id: number) {
    // §9 EXECUTION: the declared voidFlow IS this behaviour — runFlow walks
    // void → commit (DELETE /api/transactions/:id) → refresh, the exact graph
    // the Connections tab renders.
    await runFlow(voidFlow, "void", {
      state: { id },
      fetch: (url: string, init?: RequestInit) =>
        fetch(url, { ...init, credentials: "include" }),
      ui: {
        refresh: () => {
          closeDetail();
          resetAndRefetchFn?.();
          void reloadSubcategoryCounts();
        },
      },
    });
  }

  const [uploading, setUploading] = createSignal(false);
  // In-flight attachment uploads, shown as optimistic tiles (preview + spinner)
  // in the detail modal the moment the user picks files. Each resolves into a
  // real attachment merged into detailTxn on success, so the gallery updates
  // without a full refetch or a modal reopen.
  const [pendingUploads, setPendingUploads] = createSignal<PendingFile[]>([]);

  async function handleUploadAttachment(files: FileList) {
    const t = detailTxn();
    if (!t || files.length === 0) return;
    setUploading(true);
    setFormError("");
    const pending = Array.from(files).map(createPendingFile);
    setPendingUploads((prev) => [...prev, ...pending]);
    const failed: string[] = [];
    for (const pf of pending) {
      let created: Attachment | null = null;
      try {
        const fd = new FormData();
        fd.append("file", pf.file);
        const res = await fetch(`/api/transactions/${t.id}/attachments`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (res.ok) {
          created = (await res.json()) as Attachment;
        } else {
          failed.push(pf.file.name);
        }
      } catch {
        failed.push(pf.file.name);
      }
      // Merge the saved attachment into the open detail so the gallery reflects
      // it immediately, then drop the optimistic tile. Guard against the user
      // having navigated to a different transaction mid-upload.
      if (created) {
        const cur = detailTxn();
        if (cur && cur.id === t.id) {
          const attachments = [...(cur.attachments ?? []), created];
          setDetailTxn({
            ...cur,
            attachments,
            attachment_count: String(attachments.length),
          });
        }
      }
      setPendingUploads((prev) => prev.filter((p) => p.id !== pf.id));
      revokePendingFile(pf);
    }
    setUploading(false);
    // Keep the table's attachment count in sync without reopening the modal.
    resetAndRefetchFn?.();
    if (failed.length > 0) {
      setFormError(`Some files didn't upload: ${failed.join(", ")}.`);
    }
  }

  async function handleDeletePayment(txnId: number, paymentId: number) {
    if (
      !(await confirm({
        title: "Delete this payment?",
        message:
          "The payment will be removed and the outstanding balance will increase.",
        danger: true,
      }))
    )
      return;
    // §9 EXECUTION: post-confirm, deletePaymentFlow drives commit (DELETE the
    // leg) → condition → refresh (reopen detail + refresh list) on success.
    await runFlow(deletePaymentFlow, "del", {
      state: { id: txnId, paymentId },
      fetch: (url: string, init?: RequestInit) =>
        fetch(url, { ...init, credentials: "include" }),
      ui: {
        refresh: () => {
          setDetailTxn(null);
          void openDetail(txnId);
          resetAndRefetchFn?.();
        },
        toast: (m: string) =>
          console.error("[transactions] delete-payment:", m),
      },
    });
  }

  async function handleDeleteAttachment(txnId: number, attachmentId: number) {
    // §9 EXECUTION: deleteAttachmentFlow drives commit (DELETE the attachment) →
    // condition → on success merge it out of the open detail + refresh the list;
    // on failure surface the error inline.
    await runFlow(deleteAttachmentFlow, "del", {
      state: { id: txnId, attachmentId },
      fetch: (url: string, init?: RequestInit) =>
        fetch(url, { ...init, credentials: "include" }),
      ui: {
        refresh: () => {
          const t = detailTxn();
          if (t && t.id === txnId) {
            const remaining = (t.attachments || []).filter(
              (a) => a.id !== attachmentId
            );
            setDetailTxn({
              ...t,
              attachments: remaining,
              attachment_count: String(remaining.length),
            });
          }
          resetAndRefetchFn?.();
        },
        toast: () => setFormError("Could not delete attachment"),
      },
    });
  }

  const {
    expandedGroups,
    lazyDayData,
    setLazyDayData,
    toggleGroupExpanded,
    renderDayExpansion,
  } = useLazyDayGroups({
    groupSalesByDay,
    tableSearchTerm,
    statusFilter,
    subcategoryFilter,
    accountFilter,
    createdByFilter,
    columns: () => columns,
    openDetail,
  });

  const columns = makeTransactionColumns({
    expandedGroups,
    tableSearchTerm,
    peersUnavailable,
    accountsIndex,
    creatorName,
  });

  return (
    <PermissionGate when={canAccess()}>
      <PageShell
        eyebrow="FINANCE · KSERP"
        title="Transactions"
        subtitle="Every peso moving through your workspace -- sales, expenses, payables and transfers in one ledger."
        actions={
          <>
            <PageShareButton module="transactions" moduleLabel="Transactions" />
            <Button
              intent="secondary"
              variant="clip2"
              icon={Download}
              onClick={() => setExportOpen(true)}
              data-testid="transactions-export-button"
            >
              Export
            </Button>
            <Show when={canEdit()}>
              <Button
                intent="primary"
                variant="clip1"
                icon={Plus}
                data-testid="transactions-add-btn"
                onClick={() => {
                  resetForm();
                  loadOrgMembers();
                  setCreateOpen(true);
                }}
              >
                Record Transaction
              </Button>
            </Show>
          </>
        }
      >
        <div class="min-w-0 overflow-hidden">
          <DataTable<TransactionRow>
            refetchKey={() => activeWorkspace()?.ws_id}
            fetchFn={async (
              params: FetchParams
            ): Promise<FetchResult<TransactionRow>> => {
              setTableSearchTerm(params.search);
              if (lazyDayData().size > 0) setLazyDayData(new Map());
              if (groupSalesByDay()) {
                const q = new URLSearchParams({
                  page: String(params.page),
                  limit: String(params.limit),
                  search: params.search,
                  status: statusFilter(),
                  ...(subcategoryFilter()
                    ? { subcategory: subcategoryFilter() }
                    : {}),
                  ...(accountFilter() ? { accountId: accountFilter() } : {}),
                  ...(createdByFilter()
                    ? { createdBy: createdByFilter() }
                    : {}),
                });
                if (params.dateFrom) q.set("dateFrom", params.dateFrom);
                if (params.dateTo) q.set("dateTo", params.dateTo);
                const res = await fetch(
                  `/api/transactions/grouped-by-date?${q}`,
                  {
                    credentials: "include",
                  }
                );
                if (!res.ok) {
                  // The plugin server may not expose grouped-by-date; degrade
                  // to an empty grouped view rather than throwing.
                  return { data: [], total: 0 };
                }
                const result = (await res.json()) as {
                  data: Array<{
                    date: string;
                    count: number;
                    total: string;
                    currency: string;
                  }>;
                  total: number;
                };
                // Grouped view shows synthetic per-day rows (no account/payee
                // columns to resolve) — clear any stale peer-unavailable flags.
                setPeersUnavailable({ accounts: false, payees: false });
                const wsId = activeWorkspace()?.ws_id ?? 0;
                return {
                  data: result.data.map((d) => makeAggregatedRow(d, wsId)),
                  total: result.total,
                };
              }
              const q = new URLSearchParams({
                page: String(params.page),
                limit: String(params.limit),
                search: params.search,
                sortBy: params.sortBy || "",
                sortDir: params.sortDir,
                status: statusFilter(),
                ...(categoryFilterParam()
                  ? { category: categoryFilterParam() }
                  : {}),
                ...(subcategoryFilter()
                  ? { subcategory: subcategoryFilter() }
                  : {}),
                ...(accountFilter() ? { accountId: accountFilter() } : {}),
                ...(createdByFilter() ? { createdBy: createdByFilter() } : {}),
              });
              if (params.dateFrom) q.set("dateFrom", params.dateFrom);
              if (params.dateTo) q.set("dateTo", params.dateTo);
              const res = await fetch(`/api/transactions?${q}`, {
                credentials: "include",
              });
              const result = (await res.json()) as FetchResult<Transaction> & {
                peersUnavailable?: { accounts: boolean; payees: boolean };
              };
              setPeersUnavailable(
                result.peersUnavailable ?? { accounts: false, payees: false }
              );
              return {
                data: result.data as TransactionRow[],
                total: result.total,
              };
            }}
            expansionContent={(row: TransactionRow) => {
              if (!groupSalesByDay()) return null;
              if (!row._grouped || !row._groupKey) return null;
              if (!expandedGroups().has(row._groupKey)) return null;
              return renderDayExpansion(row._groupKey);
            }}
            columns={columns}
            onRowClick={(row: TransactionRow) => {
              if (row._grouped) {
                if (row._groupKey) toggleGroupExpanded(row._groupKey);
                return;
              }
              openDetail(row.id);
            }}
            searching={true}
            ordering={true}
            paging={true}
            loadMore={true}
            searchPlaceholder="Search by description, payee, or notes..."
            emptyMessage="No transactions yet. Click 'New Transaction' to create one."
            noResultsMessage="No transactions match your filters."
            dateField="transaction_date"
            dateRangeMode={true}
            filters={
              <TransactionFilters
                activeCategories={activeCategories}
                pdcFilter={pdcFilter}
                statusFilter={statusFilter}
                accountFilter={accountFilter}
                subcategoryFilter={subcategoryFilter}
                createdByFilter={createdByFilter}
                setActiveCategories={setActiveCategories}
                setPdcFilter={setPdcFilter}
                setStatusFilter={setStatusFilter}
                setAccountFilter={setAccountFilter}
                setSubcategoryFilter={setSubcategoryFilter}
                setCreatedByFilter={setCreatedByFilter}
                accounts={accounts}
                subcategoryOptions={subcategoryOptions}
                subcategoryCounts={subcategoryCounts}
                creators={creators}
                activeFilterCount={activeFilterCount}
                clearAllFilters={clearAllFilters}
                groupSalesByDay={groupSalesByDay}
                setGroupSalesByDay={setGroupSalesByDay}
              />
            }
            onRefetch={(api: { resetAndRefetch: () => void }) => {
              resetAndRefetchFn = api.resetAndRefetch;
            }}
          />
        </div>
      </PageShell>

      {/* Export Modal */}
      <Show when={exportOpen()}>
        <ExportTransactionsModal onClose={() => setExportOpen(false)} />
      </Show>

      {/* Create Modal */}
      <Show when={createOpen()}>
        <Modal variant="sheet" onClose={() => closeCreate()}>
          <div
            class="sm:w-[42rem] lg:w-[48rem] sm:max-w-[calc(100vw-2rem)] flex flex-col max-h-[88vh]"
            data-testid="transactions-create-modal"
          >
            <div class="px-5 sm:px-6 pt-5 pb-4 border-b border-zinc-800/60 flex items-center justify-between shrink-0">
              <div>
                <p class="text-[10px] tracking-[0.3em] uppercase text-amber-400 font-semibold mb-0.5">
                  New entry
                </p>
                <h2 class="text-lg font-bold text-zinc-100">
                  Record transaction
                </h2>
              </div>
              <button
                onClick={() => closeCreate()}
                class="w-10 h-10 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors ks-hud-clip-button cursor-pointer"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <TransactionForm
              error={formError()}
              saving={formSaving()}
              category={formCategory()}
              setCategory={setFormCategory}
              subcategory={formSubcategory()}
              setSubcategory={setFormSubcategory}
              sourceAccount={formSourceAccount()}
              setSourceAccount={setFormSourceAccount}
              destAccount={formDestAccount()}
              setDestAccount={setFormDestAccount}
              amount={formAmount()}
              setAmount={setFormAmount}
              description={formDescription()}
              setDescription={setFormDescription}
              notes={formNotes()}
              setNotes={setFormNotes}
              date={formDate()}
              setDate={setFormDate}
              isPrivate={formPrivate()}
              setIsPrivate={setFormPrivate}
              sharedWith={formSharedWith()}
              setSharedWith={setFormSharedWith}
              sharedRoleCodes={formSharedWithRoles()}
              setSharedRoleCodes={setFormSharedWithRoles}
              backdateReason={formBackdateReason()}
              setBackdateReason={setFormBackdateReason}
              payee={formPayee()}
              setPayee={setFormPayee}
              payeeId={formPayeeId()}
              setPayeeId={setFormPayeeId}
              refNumber={formRefNumber()}
              setRefNumber={setFormRefNumber}
              taxType={formTaxType()}
              setTaxType={setFormTaxType}
              hasEwt={formHasEwt()}
              setHasEwt={setFormHasEwt}
              ewtRate={formEwtRate()}
              setEwtRate={setFormEwtRate}
              payableKind={formPayableKind()}
              setPayableKind={setFormPayableKind}
              dueDate={formDueDate()}
              setDueDate={setFormDueDate}
              chequeNumber={formChequeNumber()}
              setChequeNumber={setFormChequeNumber}
              pdcStatus={formPdcStatus()}
              setPdcStatus={setFormPdcStatus}
              pendingFiles={formPendingFiles()}
              setPendingFiles={setFormPendingFiles}
              accounts={accounts()}
              orgMembers={orgMembers()}
              shareableRoles={shareableRoles()}
              isAdmin={isAdmin()}
              canShare={canShare()}
              isBackdated={isFormBackdated()}
              saleItems={formSaleItems()}
              setSaleItems={setFormSaleItems}
              saleClient={formSaleClient()}
              setSaleClient={setFormSaleClient}
              saleVoucher={formSaleVoucher()}
              setSaleVoucher={setFormSaleVoucher}
              saleManualDiscount={formSaleDiscount()}
              setSaleManualDiscount={setFormSaleDiscount}
              onSubmit={handleCreate}
              submitLabel="Create Transaction"
            />
          </div>
        </Modal>
      </Show>

      {/* Detail Modal */}
      <Show when={detailId() !== null}>
        <Modal
          variant="sheet"
          onClose={() => {
            if (voidConfirm()) {
              setVoidConfirm(false);
              return;
            }
            if (editing()) {
              setEditing(false);
              return;
            }
            closeDetail();
          }}
        >
          <div
            class="sm:w-[42rem] lg:w-[48rem] sm:max-w-[calc(100vw-2rem)] flex flex-col max-h-[88vh]"
            data-testid="transactions-detail-modal"
          >
            <Show
              when={detailTxn() && detailTxn()!.id === detailId()}
              fallback={
                <div
                  class="px-5 sm:px-6 pt-5 pb-4 flex items-start gap-4 border-b border-zinc-800/60 shrink-0"
                  data-testid="txn-detail-skeleton-header"
                >
                  <div class="w-12 h-12 shrink-0 animate-pulse rounded bg-white/5" />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-3 w-24 animate-pulse rounded bg-white/5" />
                    <div class="h-5 w-3/4 animate-pulse rounded bg-white/5" />
                    <div class="h-3 w-32 animate-pulse rounded bg-white/5" />
                  </div>
                  <button
                    onClick={() => closeDetail()}
                    class="w-10 h-10 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors shrink-0 ks-hud-clip-button cursor-pointer"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>
              }
            >
              {(() => {
                const t = detailTxn()!;
                const tone = CATEGORY_TONE[t.category] || CATEGORY_TONE.expense;
                const c = TONE_CLASSES[tone.tone];
                const Ico = tone.icon;
                const meta = CATEGORY_STYLES[t.category] || {
                  label: t.category,
                  class: "",
                };
                return (
                  <div class="px-5 sm:px-6 pt-5 pb-4 flex items-start gap-4 border-b border-zinc-800/60 shrink-0">
                    <div
                      class={`w-12 h-12 flex items-center justify-center border shrink-0 ${c.bg} ${c.text} ${c.border}`}
                    >
                      <Ico size={22} />
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="text-[10px] tracking-[0.3em] uppercase text-amber-400 font-bold mb-0.5">
                        {editing() ? "Editing" : meta.label} · #{t.id}
                      </p>
                      <h2 class="text-base sm:text-lg font-bold text-zinc-100 leading-snug truncate">
                        {editing() ? "Edit transaction" : t.description}
                      </h2>
                      <p class="text-xs text-zinc-500 mt-0.5">
                        {formatDate(t.transaction_date)}
                      </p>
                    </div>
                    <button
                      onClick={() => closeDetail()}
                      class="w-10 h-10 flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors shrink-0 ks-hud-clip-button cursor-pointer"
                      aria-label="Close"
                    >
                      <X size={18} />
                    </button>
                  </div>
                );
              })()}
            </Show>

            <Show
              when={
                voidConfirm() && detailTxn() && detailTxn()!.id === detailId()
              }
            >
              <div class="mx-5 sm:mx-6 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <p class="text-sm text-red-400 mb-3">
                  Are you sure you want to void this transaction? This cannot be
                  undone.
                </p>
                <div class="flex gap-2">
                  <Button
                    intent="primary"
                    variant="clip1"
                    onClick={() => handleVoid(detailTxn()!.id)}
                  >
                    Void Transaction
                  </Button>
                  <Button
                    intent="secondary"
                    variant="ghost"
                    onClick={() => setVoidConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </Show>

            <div class="flex-1 overflow-x-hidden overflow-y-auto px-5 sm:px-6 py-5">
              <Show when={formError() && !editing()}>
                <div
                  class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
                  data-testid="transactions-detail-error"
                >
                  {formError()}
                </div>
              </Show>
              <Show
                when={
                  detailTxn() && detailTxn()!.id === detailId() && !editing()
                }
              >
                <TransactionDetail
                  txn={detailTxn()!}
                  creatorName={creatorName(detailTxn()!.created_by)}
                  canEdit={canEdit()}
                  isAdmin={isAdmin()}
                  uploading={uploading()}
                  pendingUploads={pendingUploads()}
                  onUpload={handleUploadAttachment}
                  onDeleteAttachment={handleDeleteAttachment}
                  onDeletePayment={handleDeletePayment}
                  onRecordPayment={(id) =>
                    setSettleLegWizard({ txId: id, mode: "list" })
                  }
                />
              </Show>
              <Show
                when={
                  !editing() && (!detailTxn() || detailTxn()!.id !== detailId())
                }
              >
                <TransactionDetailSkeleton />
              </Show>
              <Show
                when={
                  editing() && detailTxn() && detailTxn()!.id === detailId()
                }
              >
                <TransactionForm
                  error={formError()}
                  saving={formSaving()}
                  category={formCategory()}
                  setCategory={setFormCategory}
                  subcategory={formSubcategory()}
                  setSubcategory={setFormSubcategory}
                  sourceAccount={formSourceAccount()}
                  setSourceAccount={setFormSourceAccount}
                  destAccount={formDestAccount()}
                  setDestAccount={setFormDestAccount}
                  amount={formAmount()}
                  setAmount={setFormAmount}
                  description={formDescription()}
                  setDescription={setFormDescription}
                  notes={formNotes()}
                  setNotes={setFormNotes}
                  date={formDate()}
                  setDate={setFormDate}
                  isPrivate={formPrivate()}
                  setIsPrivate={setFormPrivate}
                  sharedWith={formSharedWith()}
                  setSharedWith={setFormSharedWith}
                  sharedRoleCodes={formSharedWithRoles()}
                  setSharedRoleCodes={setFormSharedWithRoles}
                  backdateReason={formBackdateReason()}
                  setBackdateReason={setFormBackdateReason}
                  payee={formPayee()}
                  setPayee={setFormPayee}
                  payeeId={formPayeeId()}
                  setPayeeId={setFormPayeeId}
                  refNumber={formRefNumber()}
                  setRefNumber={setFormRefNumber}
                  taxType={formTaxType()}
                  setTaxType={setFormTaxType}
                  hasEwt={formHasEwt()}
                  setHasEwt={setFormHasEwt}
                  ewtRate={formEwtRate()}
                  setEwtRate={setFormEwtRate}
                  payableKind={formPayableKind()}
                  setPayableKind={setFormPayableKind}
                  dueDate={formDueDate()}
                  setDueDate={setFormDueDate}
                  chequeNumber={formChequeNumber()}
                  setChequeNumber={setFormChequeNumber}
                  pdcStatus={formPdcStatus()}
                  setPdcStatus={setFormPdcStatus}
                  pendingFiles={formPendingFiles()}
                  setPendingFiles={setFormPendingFiles}
                  accounts={accounts()}
                  orgMembers={orgMembers()}
                  shareableRoles={shareableRoles()}
                  isAdmin={isAdmin()}
                  canShare={canShare()}
                  isBackdated={isFormBackdated()}
                  saleItems={formSaleItems()}
                  setSaleItems={setFormSaleItems}
                  saleClient={formSaleClient()}
                  setSaleClient={setFormSaleClient}
                  saleVoucher={formSaleVoucher()}
                  setSaleVoucher={setFormSaleVoucher}
                  saleManualDiscount={formSaleDiscount()}
                  setSaleManualDiscount={setFormSaleDiscount}
                  onSubmit={() => form.handleUpdate(detailTxn())}
                  submitLabel="Save Changes"
                  onCancel={() => setEditing(false)}
                  existingAttachments={detailTxn()?.attachments ?? []}
                  onDeleteExistingAttachment={async (attId) => {
                    const id = detailId();
                    if (id == null) return;
                    await handleDeleteAttachment(id, attId);
                  }}
                />
              </Show>
            </div>

            <Show
              when={
                !editing() &&
                !voidConfirm() &&
                detailTxn() &&
                detailTxn()!.id === detailId() &&
                detailTxn()!.status !== "voided" &&
                (canEdit() || isAdmin())
              }
            >
              <div class="px-5 sm:px-6 py-4 border-t border-zinc-800/60 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 bg-zinc-950 shrink-0">
                <Show when={isAdmin()}>
                  <Button
                    intent="danger"
                    variant="clip1"
                    icon={Ban}
                    class="ks-hud-glow"
                    data-testid="transactions-void-btn"
                    onClick={() => setVoidConfirm(true)}
                  >
                    Void
                  </Button>
                </Show>
                <Show when={canEdit()}>
                  <Button
                    intent="secondary"
                    variant="clip1"
                    icon={Pencil}
                    class="ks-hud-glow"
                    onClick={startEdit}
                  >
                    Edit
                  </Button>
                </Show>
              </div>
            </Show>
          </div>
        </Modal>
      </Show>

      {/* Consolidated payment modal */}
      <Show when={settleLegWizard()}>
        {(target) => {
          const legIdProp = (): number | undefined => {
            const t = target();
            return t.mode === "edit-leg" ? t.legId : undefined;
          };
          return (
            <PaymentLegModal
              transactionId={target().txId}
              mode={target().mode}
              legId={legIdProp()}
              onClose={() => setSettleLegWizard(null)}
              onSuccess={() => {
                setDetailTxn(null);
                openDetail(target().txId);
                resetAndRefetchFn?.();
              }}
              onSwitchTarget={(next) => {
                const t = target();
                if (next.mode === "list") {
                  setSettleLegWizard({ txId: t.txId, mode: "list" });
                } else if (next.mode === "edit-leg") {
                  setSettleLegWizard({
                    txId: t.txId,
                    mode: "edit-leg",
                    legId: next.legId!,
                  });
                } else {
                  setSettleLegWizard({ txId: t.txId, mode: "settle" });
                }
              }}
            />
          );
        }}
      </Show>
    </PermissionGate>
  );
}
