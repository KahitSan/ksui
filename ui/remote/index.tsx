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
//    SearchableSelect, Avatar, Button, confirm) + hooks (useActiveOrg,
//    permissions) + helpers (highlightMatch) come from "@kserp/host-ui".
//  - No @solidjs/router in the remote, so URL filter-persistence is dropped;
//    filters live in plain signals. No feature-flag Navigate gate.
//  - Cross-plugin pickers (Payee/Client/Voucher/packages/accounts) fetch the
//    sibling plugin's relative API and degrade gracefully when absent.
//  - Subcategory taxonomy lives at /api/transactions/subcategories (the plugin
//    folds the monolith's /api/transaction-subcategories under its basePath).
//  - Attachments are URL-based on the plugin server; uploads POST metadata.

import "./styles.css"; // plugin Tailwind utilities (host injects /_ui/remote.css)
import {
  createEffect,
  createSignal,
  on,
  Show,
  createMemo,
  onMount,
} from "solid-js";
import {
  PageShell,
  PageShareButton,
  Modal,
  DataTable,
  Avatar,
  Button,
  confirm,
  useActiveOrg,
  usePermissions,
  PermissionGate,
  highlightMatch,
  type FetchParams,
  type FetchResult,
} from "@kserp/host-ui";
import Plus from "lucide-solid/icons/plus";
import Download from "lucide-solid/icons/download";
import X from "lucide-solid/icons/x";
import Loader2 from "lucide-solid/icons/loader-2";
import Pencil from "lucide-solid/icons/pencil";
import Ban from "lucide-solid/icons/ban";
import Trash2 from "lucide-solid/icons/trash-2";

import TransactionForm from "./components/TransactionForm";
import {
  TransactionDetail,
  TransactionDetailSkeleton,
} from "./components/TransactionDetail";
import { type SalesLine } from "./components/SalesBodyEditor";
import PaymentLegModal from "./components/PaymentLegModal";
import { AddAttachmentTile } from "@kahitsan/plugin-ui";
import ExportTransactionsModal from "./components/ExportTransactionsModal";
import TransactionFilters from "./components/TransactionFilters";
import { type ClientOption, type VoucherOption } from "@kahitsan/plugin-ui";
import {
  useAccountsIndex,
  attachmentUrl,
  isResolvableAttachment,
} from "@kahitsan/plugin-ui";
import { formatDate, formatDateTime, todayManila } from "./lib/format";
import {
  type PendingFile,
  createPendingFile,
  revokePendingFile,
  type Transaction,
  type TransactionPayment,
  type TransactionLineItem,
  type Attachment,
  type FinancialAccount,
  type OrgMember,
} from "./lib/types";
import {
  CATEGORY_STYLES,
  CATEGORY_TONE,
  TONE_CLASSES,
  PAYABLE_KIND_OPTIONS,
  PDC_OPTIONS,
  TAX_TYPE_LABELS,
} from "./lib/constants";
import { type TransactionRow, makeAggregatedRow } from "./lib/rows";
import { makeTransactionColumns } from "./components/transactionColumns";
import { useLazyDayGroups } from "./hooks/useLazyDayGroups";

export function Component() {
  const { activeOrg } = useActiveOrg();
  const perms = usePermissions();
  const canAccess = () => perms.has("transactions.view");
  const canEdit = () => perms.hasAny("transactions.create", "transactions.edit");
  const accountsIndex = useAccountsIndex();

  const isAdmin = () => perms.has("transactions.delete");
  const canBackdate = () => perms.has("transactions.backdate");
  const canShare = () => perms.hasAny("members.list_basic", "members.view");

  const ALL_CATEGORIES = ["expense", "sale", "business", "payable"] as const;

  const [activeCategories, setActiveCategories] = createSignal<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = createSignal("active");
  const [accountFilter, setAccountFilter] = createSignal("");
  const [subcategoryFilter, setSubcategoryFilter] = createSignal("");
  const [createdByFilter, setCreatedByFilter] = createSignal("");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [tableSearchTerm, setTableSearchTerm] = createSignal("");
  const [pdcFilter, setPdcFilter] = createSignal<Set<string>>(new Set());

  const [incomeSubcategories, setIncomeSubcategories] = createSignal<string[]>([]);
  const [expenseSubcategories, setExpenseSubcategories] = createSignal<string[]>([]);
  const [subcategoryCounts, setSubcategoryCounts] = createSignal<Record<string, number>>({});
  async function reloadSubcategoryCounts() {
    try {
      const r = await fetch("/api/transactions/subcategory-counts", { credentials: "include" });
      if (r.ok) {
        const json = (await r.json()) as { counts: { subcategory: string; count: number }[] };
        const map: Record<string, number> = {};
        for (const c of json.counts || []) map[c.subcategory] = c.count;
        setSubcategoryCounts(map);
      }
    } catch {
      /* nice-to-have */
    }
  }
  // Distinct creator ids + counts from the server (the kernel `user` table is
  // off the plugin's search_path, so /creators returns no names — see GET
  // /creators). Names are resolved reactively via `creatorNameById` (below) and
  // surfaced in the `creators` memo.
  const [creatorStats, setCreatorStats] = createSignal<{ id: string; count?: number }[]>([]);
  // user id -> display name for every creator. Filled from the kernel's
  // /api/users/names so it covers creators who aren't in the caller's org member
  // list (superusers, ex-members, import accounts) — members/basic can't name
  // those. Authenticated, returns only { id, name }.
  const [creatorNameById, setCreatorNameById] = createSignal<Map<string, string>>(new Map());
  async function reloadCreators() {
    try {
      const r = await fetch("/api/transactions/creators", { credentials: "include" });
      if (!r.ok) return;
      const json = (await r.json()) as { creators: { id: string; count: number }[] };
      const stats = json.creators || [];
      setCreatorStats(stats);
      const ids = stats.map((c) => c.id).filter(Boolean);
      if (ids.length === 0) return;
      const nr = await fetch(`/api/users/names?ids=${encodeURIComponent(ids.join(","))}`, {
        credentials: "include",
      });
      if (nr.ok) {
        const nj = (await nr.json()) as { users: { id: string; name: string }[] };
        setCreatorNameById(new Map((nj.users || []).map((u) => [u.id, u.name])));
      }
    } catch {
      /* nice-to-have */
    }
  }
  onMount(async () => {
    try {
      const [inc, exp] = await Promise.all([
        fetch("/api/transactions/subcategories?applies_to=income", { credentials: "include" }).then((r) =>
          r.json(),
        ),
        fetch("/api/transactions/subcategories?applies_to=expense", { credentials: "include" }).then(
          (r) => r.json(),
        ),
      ]);
      setIncomeSubcategories(((inc.subcategories as { name: string }[]) || []).map((s) => s.name));
      setExpenseSubcategories(((exp.subcategories as { name: string }[]) || []).map((s) => s.name));
    } catch {
      /* dropdown stays empty until next refresh */
    }
    await reloadSubcategoryCounts();
    await reloadCreators();
  });
  const subcategoryOptions = createMemo(() => {
    const cats = activeCategories();
    const wantsIncome = cats.has("sale");
    const wantsExpense = cats.has("expense") || cats.has("payable");
    if (wantsIncome && !wantsExpense) return incomeSubcategories();
    if (wantsExpense && !wantsIncome) return expenseSubcategories();
    return [...expenseSubcategories(), ...incomeSubcategories()];
  });

  const categoryFilterParam = () => {
    const cats = activeCategories();
    if (cats.size === 0 || cats.size === ALL_CATEGORIES.length) return "";
    return Array.from(cats).join(",");
  };

  const [groupSalesByDay, setGroupSalesByDay] = createSignal(false);

  const activeFilterCount = createMemo(
    () =>
      (searchQuery() ? 1 : 0) +
      activeCategories().size +
      pdcFilter().size +
      (accountFilter() ? 1 : 0) +
      (subcategoryFilter() ? 1 : 0) +
      (createdByFilter() ? 1 : 0) +
      (statusFilter() !== "active" ? 1 : 0) +
      (groupSalesByDay() ? 1 : 0),
  );

  function clearAllFilters() {
    setActiveCategories(new Set<string>());
    setPdcFilter(new Set<string>());
    setAccountFilter("");
    setSubcategoryFilter("");
    setCreatedByFilter("");
    setSearchQuery("");
    setStatusFilter("active");
    setGroupSalesByDay(false);
  }
  let resetAndRefetchFn: (() => void) | undefined;

  createEffect(
    on(
      () => ({
        type: activeCategories(),
        pdc: pdcFilter(),
        status: statusFilter(),
        account: accountFilter(),
        subcategory: subcategoryFilter(),
        createdBy: createdByFilter(),
        group: groupSalesByDay(),
      }),
      () => {
        resetAndRefetchFn?.();
      },
      { defer: true },
    ),
  );

  // Accounts list (for filter dropdowns + the form's account picker).
  const [accounts, setAccounts] = createSignal<FinancialAccount[]>([]);
  const [orgMembers, setOrgMembers] = createSignal<OrgMember[]>([]);
  const [shareableRoles, setShareableRoles] = createSignal<{ code: string; label: string }[]>([]);

  // Set from the list response: which name-resolving peer plugins were absent
  // for the last fetch. Account + payee names resolve over kernel RPC server-
  // side; when a peer is down the row carries no name and we render a ⚠️ marker
  // (see the Accounts/Payee columns) instead of a misleading blank.
  const [peersUnavailable, setPeersUnavailable] = createSignal<{
    accounts: boolean;
    payees: boolean;
  }>({ accounts: false, payees: false });

  // Resolve a transaction's created_by user id to a display name. The server
  // returns only the id (kernel `user` table is off the plugin's search_path —
  // see GET /creators), so names come from the kernel /api/users/names map
  // (covers non-members), falling back to the org member list.
  const creatorName = (userId: string | null | undefined): string | null => {
    if (!userId) return null;
    return (
      creatorNameById().get(userId) ??
      orgMembers().find((m) => m.user_id === userId)?.name ??
      null
    );
  };

  // The "By" filter's options: raw creator ids/counts from the server, with names
  // resolved from the org member list. Recomputes when members load, so labels go
  // from "Unknown" to the real name without a refetch. Ex-members (not in the
  // current member list) stay "Unknown".
  const creators = createMemo(() =>
    creatorStats().map((c) => ({
      id: c.id,
      name: creatorName(c.id) ?? "Unknown",
      count: c.count,
    })),
  );

  createEffect(() => {
    const gen = activeOrg()?.org_id;
    setOrgMembers([]);
    (async () => {
      try {
        const res = await fetch("/api/financial-accounts?limit=200&status=active", {
          credentials: "include",
        });
        if (res.ok && activeOrg()?.org_id === gen) {
          const data = await res.json();
          setAccounts(data.data || []);
        }
      } catch {
        /* financial-accounts plugin may be absent; account picker degrades */
      }
    })();
  });
  createEffect(() => {
    const gen = activeOrg()?.org_id;
    (async () => {
      try {
        const res = await fetch("/api/roles?scope=org", { credentials: "include" });
        if (!res.ok || activeOrg()?.org_id !== gen) return;
        const data = await res.json();
        const rows = (data.data || []) as { code: string; label: string }[];
        setShareableRoles(rows.filter((r) => r.code !== "admin"));
      } catch {
        /* roles endpoint may be absent; role-share buttons degrade */
      }
    })();
  });

  // Load org members for the list's "By" column (created_by → display name).
  // Independent of the share-picker's gated loader below: every viewer of the
  // list needs creator names, not just users who can share. Degrades to initials
  // / "Unknown" when the endpoint is unavailable or forbidden for the role.
  createEffect(() => {
    const gen = activeOrg()?.org_id;
    if (!gen) return;
    (async () => {
      try {
        const res = await fetch(`/api/organizations/${gen}/members/basic`, {
          credentials: "include",
        });
        if (res.ok && activeOrg()?.org_id === gen) {
          const data = await res.json();
          setOrgMembers(data.data || data.members || data || []);
        }
      } catch {
        /* members endpoint absent/forbidden; By column degrades to initials */
      }
    })();
  });

  function loadOrgMembers() {
    const orgId = activeOrg()?.org_id;
    if (!orgId || orgMembers().length > 0) return;
    if (!canShare()) return;
    (async () => {
      try {
        const res = await fetch(`/api/organizations/${orgId}/members/basic`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setOrgMembers(data.data || data.members || data || []);
        }
      } catch {
        /* members endpoint may be absent; share picker degrades */
      }
    })();
  }

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
  const [formSharedWithRoles, setFormSharedWithRoles] = createSignal<string[]>([]);
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
  const [formSubcategory, setFormSubcategory] = createSignal("");
  const [formPendingFiles, setFormPendingFiles] = createSignal<PendingFile[]>([]);
  const [formSaleItems, setFormSaleItems] = createSignal<SalesLine[]>([]);
  const [formSaleClient, setFormSaleClient] = createSignal<ClientOption | null>(null);
  const [formSaleVoucher, setFormSaleVoucher] = createSignal<VoucherOption | null>(null);
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
        ? ({ id: t.client_id, name_raw: t.client_name ?? "Unknown" } as ClientOption)
        : null,
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
        : null,
    );
    setFormSaleDiscount(
      t.voucher == null && t.discount_amount && parseFloat(t.discount_amount) > 0
        ? t.discount_amount
        : "",
    );
    formPendingFiles().forEach(revokePendingFile);
    setFormPendingFiles([]);
    setFormError("");
  }

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
      const res = await fetch(`/api/transactions/${id}`, { credentials: "include" });
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

  // Upload pending files as real multipart attachments. The plugin server
  // writes the bytes under UPLOAD_DIR/transactions/<orgId>/ and serves them
  // back through the kernel's /assets mount — so the stored path survives a
  // reload (a blob: object URL does not). Field name "file" matches
  // upload.single("file"). A failure is surfaced inline; the transaction is
  // already saved. Returns the names that failed.
  async function uploadPendingFiles(txnId: number, files: PendingFile[]): Promise<string[]> {
    const failed: string[] = [];
    for (const pf of files) {
      try {
        const fd = new FormData();
        fd.append("file", pf.file);
        const res = await fetch(`/api/transactions/${txnId}/attachments`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (!res.ok) failed.push(pf.file.name);
      } catch {
        failed.push(pf.file.name);
      }
    }
    return failed;
  }

  async function handleCreate() {
    if (!formDescription().trim()) {
      setFormError("Description is required");
      return;
    }
    const isSaleWithItems = formCategory() === "sale" && formSaleItems().length > 0;
    const createAmt = parseFloat(formAmount());
    if (!isSaleWithItems && (!formAmount() || !Number.isFinite(createAmt) || createAmt <= 0)) {
      setFormError("Amount must be greater than 0");
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
            destination_account_id: formDestAccount() ? parseInt(formDestAccount()) : null,
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
            source_account_id: formSourceAccount() ? parseInt(formSourceAccount()) : null,
            destination_account_id: formDestAccount() ? parseInt(formDestAccount()) : null,
            amount: formAmount(),
            description: formDescription().trim(),
            notes: formNotes().trim() || null,
            transaction_date: formDate(),
            is_private: formPrivate(),
            shared_with: formPrivate() ? formSharedWith() : [],
            shared_with_roles: formPrivate() ? formSharedWithRoles() : [],
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
            pdc_status: isPayable && formChequeNumber().trim() ? formPdcStatus() : null,
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
      const createdId = created.id ?? created.transaction_id ?? created.transaction?.id;

      let failedNames: string[] = [];
      if (createdId && formPendingFiles().length > 0) {
        failedNames = await uploadPendingFiles(createdId, formPendingFiles());
      }
      if (failedNames.length > 0) {
        setFormError(
          `Transaction saved, but some files didn't upload: ${failedNames.join(", ")}. Open the transaction to retry.`,
        );
      } else {
        closeCreate();
      }
      const cats = activeCategories();
      const createdCat = created.category ?? "sale";
      if (cats.size > 0 && !cats.has(createdCat)) setActiveCategories(new Set<string>());
      if (statusFilter() === "voided") setStatusFilter("active");
      resetAndRefetchFn?.();
      void reloadSubcategoryCounts();
    } catch {
      setFormError("Network error");
    } finally {
      setFormSaving(false);
    }
  }

  async function handleUpdate() {
    const t = detailTxn();
    if (!t) return;
    if (!formDescription().trim()) {
      setFormError("Description is required");
      return;
    }
    const isSaleWithItems = formCategory() === "sale" && formSaleItems().length > 0;
    const updateAmt = parseFloat(formAmount());
    if (!isSaleWithItems && (!formAmount() || !Number.isFinite(updateAmt) || updateAmt <= 0)) {
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
        source_account_id: formSourceAccount() ? parseInt(formSourceAccount()) : null,
        destination_account_id: formDestAccount() ? parseInt(formDestAccount()) : null,
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
        pdc_status: isPayable && formChequeNumber().trim() ? formPdcStatus() : null,
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
          !formSaleVoucher() && Number.isFinite(manualDiscountNumber) && manualDiscountNumber > 0
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
          `Saved, but some files didn't upload: ${failedNames.join(", ")}. Open the transaction to retry.`,
        );
        resetAndRefetchFn?.();
        void reloadSubcategoryCounts();
        return;
      }
      await openDetail(t.id);
      setEditing(false);
      resetAndRefetchFn?.();
      void reloadSubcategoryCounts();
    } catch {
      setFormError("Network error");
    } finally {
      setFormSaving(false);
    }
  }

  async function handleVoid(id: number) {
    try {
      await fetch(`/api/transactions/${id}`, { method: "DELETE", credentials: "include" });
      closeDetail();
      resetAndRefetchFn?.();
      void reloadSubcategoryCounts();
    } catch {
      /* ignore */
    }
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
        message: "The payment will be removed and the outstanding balance will increase.",
        danger: true,
      }))
    )
      return;
    try {
      const res = await fetch(`/api/transactions/${txnId}/payments/${paymentId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setDetailTxn(null);
      await openDetail(txnId);
      resetAndRefetchFn?.();
    } catch (err) {
      console.error("[transactions] delete-payment:", err);
    }
  }

  async function handleDeleteAttachment(txnId: number, attachmentId: number) {
    try {
      const res = await fetch(`/api/transactions/${txnId}/attachments/${attachmentId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setFormError(body.error || `Could not delete attachment (${res.status})`);
        return;
      }
      const t = detailTxn();
      if (t && t.id === txnId) {
        const remaining = (t.attachments || []).filter((a) => a.id !== attachmentId);
        setDetailTxn({ ...t, attachments: remaining, attachment_count: String(remaining.length) });
      }
      resetAndRefetchFn?.();
    } catch (err) {
      console.error("[transactions] delete-attachment:", err);
      setFormError("Could not delete attachment — check your connection");
    }
  }

  const { expandedGroups, lazyDayData, setLazyDayData, toggleGroupExpanded, renderDayExpansion } =
    useLazyDayGroups({
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
        subtitle="Every peso moving through your org -- sales, expenses, payables and transfers in one ledger."
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
            refetchKey={() => activeOrg()?.org_id}
            fetchFn={async (params: FetchParams): Promise<FetchResult<TransactionRow>> => {
              setTableSearchTerm(params.search);
              if (lazyDayData().size > 0) setLazyDayData(new Map());
              if (groupSalesByDay()) {
                const q = new URLSearchParams({
                  page: String(params.page),
                  limit: String(params.limit),
                  search: params.search,
                  status: statusFilter(),
                  ...(subcategoryFilter() ? { subcategory: subcategoryFilter() } : {}),
                  ...(accountFilter() ? { accountId: accountFilter() } : {}),
                  ...(createdByFilter() ? { createdBy: createdByFilter() } : {}),
                });
                if (params.dateFrom) q.set("dateFrom", params.dateFrom);
                if (params.dateTo) q.set("dateTo", params.dateTo);
                const res = await fetch(`/api/transactions/grouped-by-date?${q}`, {
                  credentials: "include",
                });
                if (!res.ok) {
                  // The plugin server may not expose grouped-by-date; degrade
                  // to an empty grouped view rather than throwing.
                  return { data: [], total: 0 };
                }
                const result = (await res.json()) as {
                  data: Array<{ date: string; count: number; total: string; currency: string }>;
                  total: number;
                };
                // Grouped view shows synthetic per-day rows (no account/payee
                // columns to resolve) — clear any stale peer-unavailable flags.
                setPeersUnavailable({ accounts: false, payees: false });
                const orgId = activeOrg()?.org_id ?? 0;
                return {
                  data: result.data.map((d) => makeAggregatedRow(d, orgId)),
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
                ...(categoryFilterParam() ? { category: categoryFilterParam() } : {}),
                ...(subcategoryFilter() ? { subcategory: subcategoryFilter() } : {}),
                ...(accountFilter() ? { accountId: accountFilter() } : {}),
                ...(createdByFilter() ? { createdBy: createdByFilter() } : {}),
              });
              if (params.dateFrom) q.set("dateFrom", params.dateFrom);
              if (params.dateTo) q.set("dateTo", params.dateTo);
              const res = await fetch(`/api/transactions?${q}`, { credentials: "include" });
              const result = (await res.json()) as FetchResult<Transaction> & {
                peersUnavailable?: { accounts: boolean; payees: boolean };
              };
              setPeersUnavailable(
                result.peersUnavailable ?? { accounts: false, payees: false },
              );
              return { data: result.data as TransactionRow[], total: result.total };
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
                <h2 class="text-lg font-bold text-zinc-100">Record transaction</h2>
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
                const meta = CATEGORY_STYLES[t.category] || { label: t.category, class: "" };
                return (
                  <div class="px-5 sm:px-6 pt-5 pb-4 flex items-start gap-4 border-b border-zinc-800/60 shrink-0">
                    <div class={`w-12 h-12 flex items-center justify-center border shrink-0 ${c.bg} ${c.text} ${c.border}`}>
                      <Ico size={22} />
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="text-[10px] tracking-[0.3em] uppercase text-amber-400 font-bold mb-0.5">
                        {editing() ? "Editing" : meta.label} · #{t.id}
                      </p>
                      <h2 class="text-base sm:text-lg font-bold text-zinc-100 leading-snug truncate">
                        {editing() ? "Edit transaction" : t.description}
                      </h2>
                      <p class="text-xs text-zinc-500 mt-0.5">{formatDate(t.transaction_date)}</p>
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

            <Show when={voidConfirm() && detailTxn() && detailTxn()!.id === detailId()}>
              <div class="mx-5 sm:mx-6 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <p class="text-sm text-red-400 mb-3">
                  Are you sure you want to void this transaction? This cannot be undone.
                </p>
                <div class="flex gap-2">
                  <Button intent="primary" variant="clip1" onClick={() => handleVoid(detailTxn()!.id)}>
                    Void Transaction
                  </Button>
                  <Button intent="secondary" variant="ghost" onClick={() => setVoidConfirm(false)}>
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
              <Show when={detailTxn() && detailTxn()!.id === detailId() && !editing()}>
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
                  onRecordPayment={(id) => setSettleLegWizard({ txId: id, mode: "list" })}
                />
              </Show>
              <Show when={!editing() && (!detailTxn() || detailTxn()!.id !== detailId())}>
                <TransactionDetailSkeleton />
              </Show>
              <Show when={editing() && detailTxn() && detailTxn()!.id === detailId()}>
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
                  onSubmit={handleUpdate}
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
                  <Button intent="secondary" variant="clip1" icon={Pencil} class="ks-hud-glow" onClick={startEdit}>
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
                  setSettleLegWizard({ txId: t.txId, mode: "edit-leg", legId: next.legId! });
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
