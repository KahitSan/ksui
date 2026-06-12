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
  createResource,
  createSignal,
  on,
  Show,
  For,
  createMemo,
  onMount,
  type JSX,
} from "solid-js";
import {
  PageShell,
  PageShareButton,
  Modal,
  DataTable,
  DatePicker,
  SearchableSelect,
  Avatar,
  Button,
  confirm,
  useActiveOrg,
  usePermissions,
  PermissionGate,
  highlightMatch,
  type DataTableColumn,
  type FetchParams,
  type FetchResult,
} from "@kserp/host-ui";
import Plus from "lucide-solid/icons/plus";
import Download from "lucide-solid/icons/download";
import X from "lucide-solid/icons/x";
import Loader2 from "lucide-solid/icons/loader-2";
import Pencil from "lucide-solid/icons/pencil";
import Ban from "lucide-solid/icons/ban";
import Lock from "lucide-solid/icons/lock";
import Paperclip from "lucide-solid/icons/paperclip";
import Trash2 from "lucide-solid/icons/trash-2";
import Upload from "lucide-solid/icons/upload";
import FileIcon from "lucide-solid/icons/file";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import ArrowDownLeft from "lucide-solid/icons/arrow-down-left";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import ArrowRight from "lucide-solid/icons/arrow-right";
import CalendarDays from "lucide-solid/icons/calendar-days";
import ChevronRight from "lucide-solid/icons/chevron-right";
import TriangleAlert from "lucide-solid/icons/triangle-alert";

import SalesBodyEditor, { type SalesLine } from "./components/SalesBodyEditor";
import { MarkdownNotes, CameraCapture } from "@kahitsan/plugin-ui";
import PaymentLegModal from "./components/PaymentLegModal";
import { AddAttachmentTile } from "@kahitsan/plugin-ui";
import ExportTransactionsModal from "./components/ExportTransactionsModal";
import PayeePicker, { type PayeeOption } from "./components/PayeePicker";
import { MentionTextarea } from "@kahitsan/plugin-ui";
import TransactionFilters from "./components/TransactionFilters";
import { type ClientOption, type VoucherOption } from "@kahitsan/plugin-ui";
import {
  AccountAvatar,
  ExistingAttachmentTile,
  useAccountsIndex,
  resolveAccount,
  attachmentUrl,
  isResolvableAttachment,
} from "@kahitsan/plugin-ui";
import { formatCurrency, formatDate, formatDateTime, todayManila } from "./lib/format";
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
  type ShareableRole,
} from "./lib/types";
import {
  CATEGORY_STYLES,
  CATEGORY_TONE,
  TONE_CLASSES,
  PAYABLE_KIND_OPTIONS,
  PDC_OPTIONS,
  TAX_TYPE_LABELS,
  CATEGORY_FORM,
} from "./lib/constants";

// Inline marker for a cell whose display name couldn't be resolved because the
// owning plugin (financial-accounts / payees) was unavailable for the fetch.
// Distinguishes "couldn't load" from a genuinely empty value ("—").
function PeerUnavailable(props: { title: string }) {
  return (
    <span
      class="inline-flex items-center text-amber-400/80"
      title={props.title}
      aria-label={props.title}
    >
      <TriangleAlert size={12} />
    </span>
  );
}

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
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set());

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

  interface LazyDayState {
    rows: Transaction[];
    page: number;
    total: number;
    loading: boolean;
    error: string | null;
  }
  const PER_DAY_LIMIT = 20;
  const [lazyDayData, setLazyDayData] = createSignal<Map<string, LazyDayState>>(new Map());

  async function loadDayPage(dateKey: string, append: boolean): Promise<void> {
    const current = lazyDayData().get(dateKey);
    if (current?.loading) return;
    const nextPage = append ? current!.page + 1 : 1;
    const next: LazyDayState = {
      rows: append ? (current?.rows ?? []) : [],
      page: append ? current!.page : 0,
      total: current?.total ?? 0,
      loading: true,
      error: null,
    };
    setLazyDayData((prev) => {
      const m = new Map(prev);
      m.set(dateKey, next);
      return m;
    });
    try {
      const q = new URLSearchParams({
        page: String(nextPage),
        limit: String(PER_DAY_LIMIT),
        search: tableSearchTerm(),
        sortBy: "transaction_date",
        sortDir: "desc",
        status: statusFilter(),
        category: "sale",
        ...(subcategoryFilter() ? { subcategory: subcategoryFilter() } : {}),
        ...(accountFilter() ? { accountId: accountFilter() } : {}),
        ...(createdByFilter() ? { createdBy: createdByFilter() } : {}),
        dateFrom: dateKey,
        dateTo: dateKey,
      });
      const res = await fetch(`/api/transactions?${q}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const result = (await res.json()) as FetchResult<Transaction>;
      setLazyDayData((prev) => {
        const m = new Map(prev);
        const existing = m.get(dateKey);
        m.set(dateKey, {
          rows: append ? [...(existing?.rows ?? []), ...result.data] : result.data,
          page: nextPage,
          total: result.total,
          loading: false,
          error: null,
        });
        return m;
      });
    } catch (err) {
      setLazyDayData((prev) => {
        const m = new Map(prev);
        const existing = m.get(dateKey);
        m.set(dateKey, {
          rows: existing?.rows ?? [],
          page: existing?.page ?? 0,
          total: existing?.total ?? 0,
          loading: false,
          error: String(err),
        });
        return m;
      });
    }
  }

  function toggleGroupExpanded(dateKey: string) {
    const next = new Set(expandedGroups());
    if (next.has(dateKey)) {
      next.delete(dateKey);
    } else {
      next.add(dateKey);
      const cur = lazyDayData().get(dateKey);
      if (!cur || (cur.rows.length === 0 && !cur.loading)) {
        void loadDayPage(dateKey, false);
      }
    }
    setExpandedGroups(next);
  }

  createEffect(() => {
    if (!groupSalesByDay() && expandedGroups().size > 0) {
      setExpandedGroups(new Set<string>());
      setLazyDayData(new Map());
    }
  });

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

  type TransactionRow = Transaction & {
    _grouped?: boolean;
    _groupKey?: string;
    _groupDate?: string;
    _groupCount?: number;
    _groupTotal?: number;
    _groupIds?: number[];
    _isSubrow?: boolean;
  };

  function makeAggregatedRow(d: {
    date: string;
    count: number;
    total: string | number;
    currency: string;
  }): TransactionRow {
    const totalNum = typeof d.total === "string" ? parseFloat(d.total) : d.total;
    const orgId = activeOrg()?.org_id ?? 0;
    return {
      id: -1,
      organization_id: orgId,
      category: "sale",
      subcategory: null,
      source_account_id: null,
      destination_account_id: null,
      source_account_name: null,
      destination_account_name: null,
      amount: String(Number.isFinite(totalNum) ? totalNum : 0),
      currency: d.currency || "PHP",
      description: "",
      notes: null,
      transaction_date: d.date,
      is_private: false,
      status: "active",
      is_backdated: false,
      backdate_reason: null,
      created_by: "",
      created_by_name: null,
      created_by_image: null,
      updated_by: null,
      updated_by_name: null,
      updated_by_image: null,
      attachment_count: "0",
      payee: null,
      payee_id: null,
      reference_number: null,
      tax_type: "none",
      tax_rate: "0",
      tax_amount: "0",
      subtotal: null,
      has_ewt: false,
      ewt_rate: null,
      ewt_amount: null,
      payable_kind: null,
      due_date: null,
      cheque_number: null,
      pdc_status: null,
      created_at: "",
      updated_at: "",
      _grouped: true,
      _groupKey: d.date,
      _groupDate: d.date,
      _groupCount: d.count,
      _groupTotal: Number.isFinite(totalNum) ? totalNum : 0,
    };
  }

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

  const columns: DataTableColumn<TransactionRow>[] = [
    {
      data: "transaction_date",
      title: "Date",
      orderable: true,
      className: "w-[90px]",
      render: (_val, _type, row) => {
        if (row._grouped) {
          const isOpen = expandedGroups().has(row._groupKey || "");
          return (
            <span
              class="flex items-center gap-1 text-zinc-300 text-[11px] tabular-nums whitespace-nowrap font-semibold"
              data-testid="grouped-row-date"
            >
              <Show when={isOpen} fallback={<ChevronRight size={12} class="text-zinc-500" />}>
                <ChevronDown size={12} class="text-amber-400" />
              </Show>
              {formatDate(row._groupDate || row.transaction_date)}
            </span>
          );
        }
        return (
          <span
            class="text-zinc-500 text-[11px] tabular-nums whitespace-nowrap"
            classList={{ "pl-4": !!row._isSubrow }}
          >
            {formatDate(row.transaction_date)}
          </span>
        );
      },
    },
    {
      data: "id",
      title: "TX#",
      className: "w-[60px] text-right",
      render: (_val, _type, row) => (
        <Show when={!row._grouped} fallback={<span class="text-[11px] text-zinc-700">—</span>}>
          <span class="text-[11px] tabular-nums text-zinc-500">#{row.id}</span>
        </Show>
      ),
    },
    {
      data: "description",
      title: "Description",
      orderable: true,
      render: (_val, _type, row) => {
        if (row._grouped) {
          const count = row._groupCount || 0;
          return (
            <div class="min-w-0 py-1">
              <div class="flex items-center gap-1.5">
                <span class="text-sm font-semibold text-zinc-100 truncate" data-testid="grouped-row-summary">
                  {count} {count === 1 ? "sale" : "sales"} on this day
                </span>
              </div>
            </div>
          );
        }
        return (
          <div class="min-w-0 py-1">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-medium text-zinc-100 truncate">
                {highlightMatch(row.description ?? "", tableSearchTerm())}
              </span>
              <Show when={row.is_private}>
                <Lock size={12} class="text-amber-500/60 shrink-0" />
              </Show>
              <Show when={row.is_private && (row.shared_with?.length ?? 0) > 0}>
                <SharedWithStack people={row.shared_with!} />
              </Show>
              <Show when={parseInt(row.attachment_count) > 0}>
                <span class="flex items-center gap-0.5 text-zinc-500 shrink-0">
                  <Paperclip size={12} />
                  <span class="text-[10px]">{row.attachment_count}</span>
                </span>
              </Show>
              <Show when={row.cheque_number}>
                <span class="text-[9px] uppercase tracking-widest text-amber-400/80 border border-amber-500/30 px-1 py-px shrink-0">
                  PDC
                </span>
              </Show>
            </div>
            <Show when={row.notes}>
              <MarkdownNotes value={row.notes} class="text-[11px] text-zinc-500 leading-snug mt-0.5 line-clamp-1" />
            </Show>
          </div>
        );
      },
    },
    {
      data: "subcategory",
      title: "Category",
      className: "hidden lg:table-cell w-[180px]",
      render: (_val, _type, row) => (
        <Show
          when={!row._grouped && row.subcategory}
          fallback={<span class="text-[11px] text-zinc-700">—</span>}
        >
          <span class="inline-block text-[11px] text-zinc-400 truncate">{row.subcategory}</span>
        </Show>
      ),
    },
    {
      data: "payee",
      title: "Payee",
      className: "hidden md:table-cell w-[160px]",
      render: (_val, _type, row) => {
        if (!row._grouped && row.payee) {
          return (
            <span class="text-xs text-zinc-300 truncate">
              {highlightMatch(row.payee ?? "", tableSearchTerm())}
            </span>
          );
        }
        // Has a payee but the name couldn't be loaded because the payees plugin
        // was unavailable for this fetch — show a marker, not a blank.
        if (!row._grouped && row.payee_id != null && peersUnavailable().payees) {
          return <PeerUnavailable title="Payees plugin unavailable — couldn't load payee name" />;
        }
        return <span class="text-[11px] text-zinc-700">—</span>;
      },
    },
    {
      data: null,
      title: "Accounts",
      className: "hidden md:table-cell w-[220px]",
      render: (_val, _type, row) => {
        if (row._grouped) {
          return <span class="text-[11px] text-zinc-700">—</span>;
        }
        // The row references an account but no name resolved because the
        // financial-accounts plugin was unavailable for this fetch — show a
        // marker for the whole cell instead of misleading dashes.
        const hasAccount = row.source_account_id != null || row.destination_account_id != null;
        const nameResolved = !!(row.source_account_name || row.destination_account_name);
        if (hasAccount && !nameResolved && peersUnavailable().accounts) {
          return (
            <PeerUnavailable title="Financial accounts plugin unavailable — couldn't load accounts" />
          );
        }
        const srcAcct = resolveAccount(accountsIndex(), row.source_account_id);
        const dstAcct = resolveAccount(accountsIndex(), row.destination_account_id);
        if (row.category === "business") {
          return (
            <span class="flex items-center gap-1.5 text-xs text-zinc-400 truncate">
              <Show when={srcAcct}>{(a) => <AccountAvatar account={a()} size={14} />}</Show>
              <span class="text-zinc-500 truncate">{row.source_account_name || "—"}</span>
              <ArrowRight size={10} class="text-zinc-600 shrink-0" />
              <Show when={dstAcct}>{(a) => <AccountAvatar account={a()} size={14} />}</Show>
              <span class="text-zinc-300 truncate">{row.destination_account_name || "—"}</span>
            </span>
          );
        }
        if (row.category === "sale") {
          return (
            <span class="flex items-center gap-1.5 text-xs text-zinc-400 truncate">
              <ArrowDownLeft size={10} class="text-emerald-500/70 shrink-0" />
              <Show when={dstAcct}>{(a) => <AccountAvatar account={a()} size={14} />}</Show>
              <span class="text-zinc-300 truncate">{row.destination_account_name || "—"}</span>
            </span>
          );
        }
        return (
          <span class="flex items-center gap-1.5 text-xs text-zinc-400 min-w-0">
            <ArrowUpRight
              size={10}
              class={row.category === "payable" ? "text-amber-400/80 shrink-0" : "text-red-500/70 shrink-0"}
            />
            <Show
              when={dstAcct || row.destination_account_name}
              fallback={
                <Show
                  when={row.source_account_name}
                  fallback={<span class="text-zinc-300 truncate">{"—"}</span>}
                >
                  <Show when={srcAcct}>{(a) => <AccountAvatar account={a()} size={14} />}</Show>
                  <span class="text-zinc-300 truncate">{row.source_account_name}</span>
                </Show>
              }
            >
              <Show when={dstAcct}>{(a) => <AccountAvatar account={a()} size={14} />}</Show>
              <span class="text-zinc-300 truncate">{row.destination_account_name}</span>
              <Show when={row.source_account_name}>
                <span class="inline-flex items-center gap-1 text-zinc-600 truncate">
                  <span>·</span>
                  <Show when={srcAcct}>{(a) => <AccountAvatar account={a()} size={14} />}</Show>
                  <span class="truncate">{row.source_account_name}</span>
                </span>
              </Show>
            </Show>
          </span>
        );
      },
    },
    {
      data: null,
      title: "By",
      className: "hidden lg:table-cell w-[60px] text-center",
      render: (_val, _type, row) => {
        if (row._grouped) {
          return <span class="text-[11px] text-zinc-700">—</span>;
        }
        // created_by is a kernel user id; the server can't join the kernel
        // `user` table, so resolve the display name from the host's org member
        // list. Falls back to "Unknown" until members load / for ex-members.
        const name = creatorName(row.created_by) || row.created_by_name || "Unknown";
        return (
          <div class="flex justify-center">
            <Avatar name={name} image={row.created_by_image} size="sm" />
          </div>
        );
      },
    },
    {
      data: "amount",
      title: "Amount",
      orderable: true,
      className: "text-right w-[140px]",
      render: (_val, _type, row) => {
        const tone = CATEGORY_TONE[row.category] || CATEGORY_TONE.expense;
        const t = TONE_CLASSES[tone.tone];
        const amt = row._grouped ? String(row._groupTotal ?? 0) : row.amount;
        const isVoided = !row._grouped && row.status === "voided";
        const balanceNum =
          !row._grouped && !isVoided && row.payment_status === "partial" && row.balance != null
            ? parseFloat(row.balance)
            : 0;
        const showBalance = balanceNum > 0;
        return (
          <div class="flex flex-col items-end gap-0.5">
            <span
              class={`text-sm font-bold tabular-nums whitespace-nowrap ${t.text} ${
                isVoided ? "line-through text-zinc-500" : ""
              }`}
              data-testid={row._grouped ? "grouped-row-total" : undefined}
            >
              {tone.sign}
              {formatCurrency(amt)}
            </span>
            <Show when={isVoided}>
              <span
                class="text-[10px] font-bold tabular-nums whitespace-nowrap text-red-400 uppercase tracking-wider"
                data-testid="transaction-row-voided-badge"
              >
                Voided
              </span>
            </Show>
            <Show when={showBalance}>
              <span
                class="text-[10px] font-bold tabular-nums whitespace-nowrap text-amber-400 uppercase tracking-wider"
                data-testid="transaction-row-balance"
                title="Outstanding balance"
              >
                Bal {formatCurrency(balanceNum)}
              </span>
            </Show>
          </div>
        );
      },
    },
    {
      data: null,
      title: "",
      className: "w-[28px]",
      render: (_val, _type, row) => {
        if (row._grouped) {
          const isOpen = expandedGroups().has(row._groupKey || "");
          return isOpen ? (
            <ChevronDown size={14} class="text-amber-400 inline" />
          ) : (
            <ChevronRight size={14} class="text-zinc-600 inline" />
          );
        }
        return <ChevronRight size={14} class="text-zinc-600 inline" />;
      },
    },
  ];

  function renderDayExpansion(dateKey: string): JSX.Element {
    const state = lazyDayData().get(dateKey);
    if (!state || (state.loading && state.rows.length === 0)) {
      return (
        <div class="p-4 text-xs text-zinc-500" data-testid={`expansion-loading-${dateKey}`}>
          Loading transactions for this day…
        </div>
      );
    }
    if (state.error && state.rows.length === 0) {
      return (
        <div class="p-4 text-xs text-rose-400 flex items-center gap-3">
          <span>Failed to load transactions for this day.</span>
          <button type="button" class="underline" onClick={() => void loadDayPage(dateKey, false)}>
            Retry
          </button>
        </div>
      );
    }
    return (
      <div class="max-h-96 overflow-y-auto" data-testid={`expansion-panel-${dateKey}`}>
        <table class="w-full text-left text-sm">
          <tbody>
            <For each={state.rows}>
              {(sub) => (
                <tr
                  class="border-t border-zinc-800/30 hover:bg-zinc-800/40 cursor-pointer"
                  onClick={() => openDetail(sub.id)}
                  data-testid={`expansion-subrow-${sub.id}`}
                >
                  <For each={columns}>
                    {(col) => (
                      <td class={`px-4 py-2 ${col.className || ""}`}>
                        {col.render
                          ? col.render(
                              col.data
                                ? (sub[col.data as keyof Transaction] as
                                    | TransactionRow[keyof TransactionRow]
                                    | null)
                                : null,
                              "display",
                              { ...sub, _isSubrow: true } as TransactionRow,
                              { row: 0, col: 0, search: "" },
                            )
                          : String(col.data ? ((sub[col.data as keyof Transaction] as unknown) ?? "") : "")}
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={state.rows.length < state.total}>
          <div class="border-t border-zinc-800/30 p-2 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
            <span>
              Showing {state.rows.length} of {state.total}
            </span>
            <button
              type="button"
              data-testid={`day-show-more-${dateKey}`}
              disabled={state.loading}
              onClick={() => void loadDayPage(dateKey, true)}
              class="rounded-lg border border-zinc-800/50 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:border-amber-500/40 hover:text-amber-400 disabled:opacity-50"
            >
              {state.loading ? "Loading…" : "Show more"}
            </button>
          </div>
        </Show>
      </div>
    );
  }

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
                return { data: result.data.map(makeAggregatedRow), total: result.total };
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

// --- Sub-components ---

function SharedWithStack(props: {
  people: { user_id: string; name: string; image?: string | null }[];
}) {
  const MAX = 3;
  const visible = () => props.people.slice(0, MAX);
  const extra = () => Math.max(0, props.people.length - MAX);
  const fullList = () => props.people.map((p) => p.name).join(", ");
  return (
    <span class="hidden sm:flex items-center -space-x-1.5 shrink-0" title={`Shared with: ${fullList()}`}>
      <For each={visible()}>
        {(p) => <Avatar name={p.name} image={p.image} size="xs" class="ring-2 ring-zinc-950" />}
      </For>
      <Show when={extra() > 0}>
        <span class="w-5 h-5 rounded-full ring-2 ring-zinc-950 bg-zinc-700 flex items-center justify-center text-[8px] font-semibold text-zinc-200 select-none">
          +{extra()}
        </span>
      </Show>
    </span>
  );
}

function TransactionDetailSkeleton() {
  return (
    <div class="space-y-4" data-testid="txn-detail-skeleton">
      <div class="-mx-5 sm:-mx-6 -mt-5 px-6 py-6 border-b border-zinc-800/60 text-center bg-gradient-to-b from-transparent to-zinc-900/40">
        <div class="mx-auto h-10 w-48 sm:h-12 sm:w-56 animate-pulse rounded bg-white/5" />
        <div class="mx-auto mt-3 h-3 w-32 animate-pulse rounded bg-white/5" />
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <For each={Array(6)}>
          {() => (
            <div class="space-y-2">
              <div class="h-3 w-20 animate-pulse rounded bg-white/5" />
              <div class="h-4 w-full animate-pulse rounded bg-white/5" />
            </div>
          )}
        </For>
      </div>
      <div class="space-y-2 pt-2">
        <div class="h-3 w-16 animate-pulse rounded bg-white/5" />
        <div class="h-4 w-5/6 animate-pulse rounded bg-white/5" />
        <div class="h-4 w-2/3 animate-pulse rounded bg-white/5" />
      </div>
    </div>
  );
}

function TransactionDetail(props: {
  txn: Transaction;
  creatorName: string | null;
  canEdit: boolean;
  isAdmin: boolean;
  uploading: boolean;
  pendingUploads: PendingFile[];
  onUpload: (files: FileList) => void;
  onDeleteAttachment: (txnId: number, attachmentId: number) => void;
  onDeletePayment?: (txnId: number, paymentId: number) => void;
  onRecordPayment?: (txnId: number) => void;
}) {
  const t = props.txn;
  const tone = CATEGORY_TONE[t.category] || CATEGORY_TONE.expense;
  const c = TONE_CLASSES[tone.tone];
  const accountsIndex = useAccountsIndex();
  let fileInput: HTMLInputElement | undefined;
  let cameraInput: HTMLInputElement | undefined;

  const [showAdvanced, setShowAdvanced] = createSignal(false);

  const hasAdvancedFields = () => {
    const hasTaxType = !!t.tax_type;
    const hasVat =
      (t.tax_type === "vat_inclusive" || t.tax_type === "vat_exclusive") &&
      t.tax_amount !== null &&
      t.tax_amount !== undefined &&
      parseFloat(t.tax_amount) > 0;
    const hasEwt = !!t.has_ewt;
    return hasTaxType || hasVat || hasEwt;
  };

  return (
    <div class="space-y-4">
      <div class="-mx-5 sm:-mx-6 -mt-5 px-6 py-6 border-b border-zinc-800/60 text-center bg-gradient-to-b from-transparent to-zinc-900/40">
        <div class={`text-4xl sm:text-5xl font-bold tabular-nums leading-none ${c.text}`}>
          {tone.sign}
          {formatCurrency(t.amount)}
        </div>
        <Show
          when={
            t.tax_type !== "vat_exempt" && t.tax_type !== "non_vat" && parseFloat(t.tax_amount) > 0
          }
        >
          <div class="mt-2 text-[11px] text-zinc-500 tabular-nums">
            Subtotal {formatCurrency(t.subtotal || "0")}
            {" · "}
            VAT ({t.tax_type === "vat_inclusive" ? "incl." : "excl."} {t.tax_rate}%){" "}
            {formatCurrency(t.tax_amount)}
          </div>
        </Show>
        <Show when={t.tax_type === "vat_exempt"}>
          <div class="mt-2 text-[10px] uppercase tracking-widest text-zinc-600">VAT Exempt</div>
        </Show>
        <Show when={t.tax_type === "non_vat"}>
          <div class="mt-2 text-[10px] uppercase tracking-widest text-zinc-600">Non-VAT</div>
        </Show>
        <Show when={t.status !== "completed"}>
          <div class="mt-3 inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-zinc-300">
            {t.status}
          </div>
        </Show>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Show when={t.category !== "business"}>
          <DetailRow
            label={
              t.category === "sale" ? "Received from" : t.category === "payable" ? "Payable to" : "Paid to"
            }
            value={t.payee}
          />
        </Show>
        <Show
          when={t.category === "business"}
          fallback={
            <DetailRow
              label={
                t.category === "sale"
                  ? "Received in"
                  : t.category === "payable"
                    ? "Funding account"
                    : "Paid from"
              }
              value={t.category === "sale" ? t.destination_account_name : t.source_account_name}
              accountId={t.category === "sale" ? t.destination_account_id : t.source_account_id}
            />
          }
        >
          <DetailRow label="From account" value={t.source_account_name} accountId={t.source_account_id} />
          <DetailRow label="To account" value={t.destination_account_name} accountId={t.destination_account_id} />
        </Show>
        <DetailRow label="Date" value={formatDate(t.transaction_date)} />
        <Show when={t.reference_number}>
          <DetailRow label="Receipt / Reference #" value={t.reference_number} />
        </Show>
        <Show when={t.subcategory}>
          <DetailRow label="Category" value={t.subcategory} />
        </Show>
      </div>

      <Show when={t.category === "sale" && (t.line_items?.length ?? 0) > 0}>
        <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
          <div class="flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-emerald-400 font-semibold">
            <span>Packages availed</span>
            <Show when={t.client_name}>
              <span class="text-zinc-500 normal-case tracking-normal text-xs font-normal">
                Billed to {t.client_name}
              </span>
            </Show>
          </div>
          <div class="space-y-1.5">
            <For each={t.line_items}>
              {(li) => (
                <div class="flex items-start justify-between gap-3 text-sm">
                  <div class="min-w-0">
                    <div class="text-zinc-200 truncate">
                      {li.package_name ?? li.description}
                      <Show when={li.variant_name}>
                        <span class="text-zinc-500"> · {li.variant_name}</span>
                      </Show>
                    </div>
                    <div class="text-[11px] text-zinc-500 tabular-nums">
                      {li.quantity} × {formatCurrency(li.unit_price)}
                      <Show when={li.client_name && li.client_name !== t.client_name}>
                        <span> · for {li.client_name}</span>
                      </Show>
                    </div>
                  </div>
                  <div class="text-zinc-300 tabular-nums whitespace-nowrap">
                    {formatCurrency((li.quantity * parseFloat(li.unit_price)).toFixed(2))}
                  </div>
                </div>
              )}
            </For>
          </div>
          <Show when={t.voucher || (t.discount_amount && parseFloat(t.discount_amount) > 0)}>
            <div class="border-t border-emerald-500/15 pt-2 text-[11px] text-zinc-400 tabular-nums flex items-center justify-between">
              <span>
                <Show when={t.voucher} fallback="Manual discount">
                  Voucher {t.voucher!.code}
                </Show>
              </span>
              <span>− {formatCurrency(t.discount_amount ?? "0")}</span>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={t.category === "sale" && t.payment_status != null}>
        <div
          class={`rounded-lg border p-3 space-y-2 ${
            t.payment_status === "partial"
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-zinc-800/60 bg-zinc-900/40"
          }`}
          data-testid="transaction-detail-payments"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-[10px] uppercase tracking-widest font-semibold">
              <span
                class={
                  t.payment_status === "partial"
                    ? "text-amber-400"
                    : t.payment_status === "paid"
                      ? "text-emerald-400"
                      : "text-zinc-400"
                }
              >
                Payments
              </span>
              <Show when={t.payment_status === "partial"}>
                <span class="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300 normal-case tracking-normal">
                  Partial
                </span>
              </Show>
              <Show when={t.payment_status === "paid"}>
                <span class="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 normal-case tracking-normal">
                  Paid
                </span>
              </Show>
              <Show when={t.payment_status === "unpaid"}>
                <span class="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300 normal-case tracking-normal">
                  Unpaid
                </span>
              </Show>
            </div>
            <Show when={t.payment_status === "partial" || t.payment_status === "unpaid"}>
              <span class="text-[11px] tabular-nums text-amber-300">
                Balance {formatCurrency(t.balance ?? "0")}
              </span>
            </Show>
          </div>

          <Show
            when={(t.payments?.length ?? 0) > 0}
            fallback={
              <p class="text-xs text-zinc-500 italic">
                No payments recorded yet — this sale is fully outstanding.
              </p>
            }
          >
            <div class="space-y-1.5">
              <For each={t.payments}>
                {(p) => (
                  <div class="rounded-md border border-zinc-800/60 bg-zinc-900/40 px-2.5 py-2">
                    <div class="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                      <span class="tabular-nums font-medium text-zinc-300">
                        TP#{p.id}
                        <span class="text-zinc-600 font-normal">
                          {" · "}
                          {formatDateTime(p.created_at)}
                        </span>
                      </span>
                      <Show when={props.canEdit && t.status !== "voided" && props.onDeletePayment}>
                        <button
                          type="button"
                          aria-label="Delete payment"
                          data-testid={`transaction-detail-delete-payment-${p.id}`}
                          onClick={() => props.onDeletePayment?.(t.id, p.id)}
                          class="ks-interactive inline-flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
                          title="Delete payment"
                        >
                          <Trash2 size={12} />
                        </button>
                      </Show>
                    </div>
                    <div class="mt-1 w-full flex items-center gap-1.5 min-w-0">
                      <Show when={resolveAccount(accountsIndex(), p.financial_account_id)}>
                        {(a) => <AccountAvatar account={a()} size={16} />}
                      </Show>
                      <span class="text-[11px] text-zinc-300 truncate flex-1">
                        {p.financial_account_name ?? `Account #${p.financial_account_id}`}
                      </span>
                      <span class="text-[11px] font-semibold tabular-nums text-zinc-100 shrink-0">
                        {formatCurrency(p.amount)}
                      </span>
                    </div>
                    <Show when={p.notes}>
                      <div class="mt-1 text-[10px] text-zinc-500 truncate">{p.notes}</div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show
            when={
              (t.payment_status === "partial" || t.payment_status === "unpaid") &&
              props.canEdit &&
              t.status !== "voided" &&
              props.onRecordPayment
            }
          >
            <button
              type="button"
              data-testid="transaction-detail-record-payment"
              onClick={() => props.onRecordPayment?.(t.id)}
              class="ks-interactive w-full rounded-md border-2 border-dashed border-zinc-700 bg-zinc-900/20 px-2.5 py-3 text-zinc-500 hover:border-amber-500/50 hover:bg-amber-500/5 hover:text-amber-300 transition-colors cursor-pointer"
            >
              <span class="flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
                <Plus size={12} />
                Add payment
              </span>
            </button>
          </Show>
        </div>
      </Show>

      <Show when={t.category === "payable"}>
        <div class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
          <div class="flex items-center gap-2 text-[10px] uppercase tracking-widest text-amber-400 font-semibold">
            <CalendarDays size={12} />
            <span>Payable</span>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <DetailRow
              label="Kind"
              value={
                t.payable_kind
                  ? PAYABLE_KIND_OPTIONS.find((p) => p.id === t.payable_kind)?.label || t.payable_kind
                  : null
              }
            />
            <DetailRow label="Due date" value={t.due_date ? formatDate(t.due_date) : null} />
            <Show when={t.cheque_number}>
              <DetailRow label="Cheque #" value={t.cheque_number} />
              <DetailRow
                label="PDC status"
                value={
                  t.pdc_status ? PDC_OPTIONS.find((p) => p.id === t.pdc_status)?.label || t.pdc_status : null
                }
              />
            </Show>
          </div>
        </div>
      </Show>

      <Show when={t.is_backdated}>
        <div class="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 ks-hud-clip-button">
          <span class="text-[10px] uppercase tracking-widest text-amber-400 font-semibold">
            Backdated
          </span>
          <Show when={t.backdate_reason}>
            <p class="text-xs text-zinc-400 mt-1">{t.backdate_reason}</p>
          </Show>
        </div>
      </Show>

      <Show when={t.notes}>
        <div>
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">Notes</p>
          <MarkdownNotes value={t.notes} class="text-sm text-zinc-300 leading-relaxed" />
        </div>
      </Show>

      <Show when={hasAdvancedFields()}>
        <div class="border-t border-zinc-800/50 pt-3">
          <button
            type="button"
            data-testid="detail-advanced-toggle"
            aria-expanded={showAdvanced()}
            onClick={() => setShowAdvanced(!showAdvanced())}
            class="flex items-center gap-2 text-xs text-zinc-500 hover:text-amber-400 transition-colors cursor-pointer"
          >
            <span>{showAdvanced() ? "Hide advanced details" : "Show advanced details"}</span>
            <Show when={showAdvanced()} fallback={<ChevronDown class="text-zinc-600" size={14} />}>
              <ChevronUp class="text-zinc-600" size={14} />
            </Show>
          </button>
          <Show when={showAdvanced()}>
            <div data-testid="detail-advanced-section" class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Show when={t.tax_type}>
                <DetailRow label="Tax type" value={TAX_TYPE_LABELS[t.tax_type] || t.tax_type} />
              </Show>
              <Show
                when={
                  (t.tax_type === "vat_inclusive" || t.tax_type === "vat_exclusive") &&
                  t.tax_amount !== null &&
                  t.tax_amount !== undefined &&
                  parseFloat(t.tax_amount) > 0
                }
              >
                <DetailRow label={`VAT (${t.tax_rate}%)`} value={formatCurrency(t.tax_amount)} />
                <Show when={t.subtotal !== null && t.subtotal !== undefined}>
                  <DetailRow label="VAT base" value={formatCurrency(t.subtotal || "0")} />
                </Show>
              </Show>
              <Show when={t.has_ewt}>
                <DetailRow
                  label={`EWT (${t.ewt_rate || "0"}%)`}
                  value={t.ewt_amount ? formatCurrency(t.ewt_amount) : "—"}
                />
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      <div class="flex flex-wrap gap-x-8 gap-y-3 pt-2 border-t border-zinc-800/50">
        <div>
          <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold block mb-1.5">
            Created by
          </span>
          <div class="flex items-center gap-2">
            <Avatar name={props.creatorName || t.created_by_name || "Unknown"} image={t.created_by_image} size="md" />
            <div class="min-w-0">
              <span class="text-sm text-zinc-200 block truncate">{props.creatorName || t.created_by_name || "Unknown"}</span>
              <span class="text-[11px] text-zinc-500 block">{new Date(t.created_at).toLocaleString()}</span>
            </div>
          </div>
        </div>
        <Show when={t.updated_by && t.updated_at && t.updated_at !== t.created_at}>
          <div>
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold block mb-1.5">
              Last updated by
            </span>
            <div class="flex items-center gap-2">
              <Avatar name={t.updated_by_name || "Unknown"} image={t.updated_by_image} size="md" />
              <div class="min-w-0">
                <span class="text-sm text-zinc-200 block truncate">{t.updated_by_name || "Unknown"}</span>
                <span class="text-[11px] text-zinc-500 block">{new Date(t.updated_at).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </Show>
      </div>

      <Show when={t.is_private}>
        <div class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 ks-hud-clip-button">
          <span class="text-[10px] uppercase tracking-widest text-amber-400 font-semibold flex items-center gap-1.5">
            <Lock size={10} /> Private transaction
          </span>
          <Show
            when={t.shared_with && t.shared_with.length > 0}
            fallback={<span class="text-xs text-zinc-500 mt-1 block">Only visible to creator</span>}
          >
            <div class="flex flex-wrap gap-1 mt-2">
              <For each={t.shared_with}>
                {(u) => (
                  <span class="inline-block rounded-full border border-zinc-700 bg-zinc-800/50 px-2 py-0.5 text-xs text-zinc-300">
                    {u.name}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <div class="border-t border-zinc-800/50 pt-4 mt-2">
        <div class="flex items-center gap-1 mb-2 text-xs text-zinc-500">
          <Paperclip size={12} /> Attachments
          <Show when={props.txn.attachments && props.txn.attachments.length > 0}>
            <span class="text-zinc-600">({props.txn.attachments!.length})</span>
          </Show>
        </div>

        <div class="flex gap-2 overflow-x-auto pt-3 pr-3 pb-2 items-start">
          <For each={props.txn.attachments}>
            {(att) => (
              <div class="relative group shrink-0">
                <Show
                  when={isResolvableAttachment(att.s3_link)}
                  fallback={
                    <div
                      class="flex w-24 h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 px-2 text-center text-zinc-500"
                      title={`${att.file_name} — file is no longer available`}
                    >
                      <TriangleAlert size={18} class="text-amber-500/70" />
                      <span class="truncate max-w-full text-[10px]">{att.file_name}</span>
                      <span class="text-[9px] uppercase tracking-wider">Unavailable</span>
                    </div>
                  }
                >
                  <Show
                    when={att.mime_type.startsWith("image/")}
                    fallback={
                      <a
                        href={attachmentUrl(att.s3_link)}
                        target="_blank"
                        rel="noopener"
                        class="flex w-24 h-24 flex-col items-center justify-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 text-xs text-zinc-300 hover:border-amber-500/30"
                      >
                        <Paperclip size={20} />
                        <span class="truncate max-w-full text-[10px]">{att.file_name}</span>
                      </a>
                    }
                  >
                    <a
                      href={attachmentUrl(att.s3_link)}
                      target="_blank"
                      rel="noopener"
                      class="block rounded-lg border border-zinc-700 overflow-hidden hover:border-amber-500/30"
                    >
                      <img src={attachmentUrl(att.s3_link)} alt={att.file_name} class="w-24 h-24 object-cover" />
                    </a>
                  </Show>
                </Show>
                <Show when={props.canEdit}>
                  <button
                    aria-label="Remove attachment"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: "Remove attachment?",
                          message: `Remove attachment "${att.file_name}"?`,
                          confirmLabel: "Remove",
                          danger: true,
                        })
                      ) {
                        props.onDeleteAttachment(t.id, att.id);
                      }
                    }}
                    class="absolute -top-2 -right-2 flex w-7 h-7 items-center justify-center rounded-full bg-red-600/90 border border-red-400/60 text-white cursor-pointer hover:bg-red-500 active:bg-red-700 shadow-lg"
                  >
                    <X size={12} />
                  </button>
                </Show>
              </div>
            )}
          </For>
          <For each={props.pendingUploads}>
            {(pf) => (
              <div class="relative shrink-0">
                <div class="w-24 h-24 rounded-lg border border-zinc-700 bg-zinc-800/50 overflow-hidden flex items-center justify-center">
                  <Show
                    when={pf.previewUrl}
                    fallback={<Paperclip size={20} class="text-zinc-500" />}
                  >
                    <img
                      src={pf.previewUrl!}
                      alt={pf.file.name}
                      class="w-24 h-24 object-cover opacity-40"
                    />
                  </Show>
                </div>
                <div
                  class="absolute inset-0 flex items-center justify-center"
                  aria-label="Uploading attachment"
                >
                  <Loader2 size={22} class="animate-spin text-amber-400" />
                </div>
              </div>
            )}
          </For>
          <Show when={props.canEdit && t.status !== "voided"}>
            <AddAttachmentTile
              uploading={props.uploading}
              onPickFile={() => fileInput?.click()}
              onPickCamera={() => cameraInput?.click()}
            />
          </Show>
          <Show
            when={
              (!props.txn.attachments || props.txn.attachments.length === 0) &&
              props.pendingUploads.length === 0 &&
              !props.canEdit
            }
          >
            <p class="text-xs text-zinc-600 self-center">No attachments</p>
          </Show>
        </div>

        <Show when={props.canEdit && t.status !== "voided"}>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf"
            multiple
            class="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                props.onUpload(e.target.files);
                e.target.value = "";
              }
            }}
          />
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            class="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                props.onUpload(e.target.files);
                e.target.value = "";
              }
            }}
          />
        </Show>
      </div>
    </div>
  );
}

function AccountPicker(props: {
  accounts: FinancialAccount[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  excludeId?: string;
  autoDefault?: boolean;
}) {
  const visible = () =>
    props.accounts.filter((a) => !props.excludeId || a.id.toString() !== props.excludeId);

  createEffect(() => {
    if (props.autoDefault === false) return;
    if (props.value) return;
    const first = visible()[0];
    if (first) props.onChange(first.id.toString());
  });

  const buttonRefs: (HTMLButtonElement | undefined)[] = [];

  const currentIndex = () => {
    const list = visible();
    const i = list.findIndex((a) => a.id.toString() === props.value);
    return i >= 0 ? i : 0;
  };

  const selectByIndex = (idx: number) => {
    const list = visible();
    if (list.length === 0) return;
    const wrapped = ((idx % list.length) + list.length) % list.length;
    props.onChange(list[wrapped].id.toString());
    buttonRefs[wrapped]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        selectByIndex(currentIndex() + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        selectByIndex(currentIndex() - 1);
        break;
      case "Home":
        e.preventDefault();
        selectByIndex(0);
        break;
      case "End":
        e.preventDefault();
        selectByIndex(visible().length - 1);
        break;
    }
  };

  return (
    <Show
      when={props.accounts.length > 0}
      fallback={
        <input
          type="number"
          value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          aria-label={props.ariaLabel}
          placeholder="Account ID (financial-accounts module unavailable)"
          class="w-full bg-zinc-900/60 border border-zinc-800/60 px-3 py-3 text-sm text-zinc-200 ks-hud-clip-button focus:outline-none focus:border-amber-500/50"
        />
      }
    >
      <div
        role="radiogroup"
        aria-label={props.ariaLabel}
        tabIndex={-1}
        class="grid max-sm:grid-cols-2 sm:grid-cols-3 gap-2"
        onKeyDown={onKeyDown}
      >
        <For each={visible()}>
          {(a, i) => {
            const selected = () => props.value === a.id.toString();
            const isTabStop = () => selected() || (!props.value && i() === 0);
            return (
              <button
                ref={(el) => (buttonRefs[i()] = el)}
                type="button"
                role="radio"
                aria-checked={selected()}
                tabIndex={isTabStop() ? 0 : -1}
                onClick={() => props.onChange(a.id.toString())}
                class="group flex items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm transition-colors cursor-pointer ks-hud-clip-top-left-bottom-right"
                classList={{
                  "border-amber-500/50 bg-amber-600/10 text-amber-300": selected(),
                  "border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800":
                    !selected(),
                }}
              >
                <span
                  class="h-2 w-2 rounded-full shrink-0"
                  classList={{
                    "bg-amber-400": selected(),
                    "bg-zinc-600 group-hover:bg-zinc-500": !selected(),
                  }}
                />
                <span class="truncate">{a.name}</span>
              </button>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

function DetailRow(props: {
  label: string;
  value: string | null | undefined;
  accountId?: number | null;
}) {
  const accountsIndex = useAccountsIndex();
  const acct = () => (props.accountId != null ? resolveAccount(accountsIndex(), props.accountId) : null);
  return (
    <div class="bg-zinc-900/40 border border-zinc-800/60 px-4 py-3 ks-hud-clip-button">
      <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">
        {props.label}
      </div>
      <div class="text-sm text-zinc-100 font-medium leading-snug break-words flex items-center gap-2">
        <Show when={acct()}>{(a) => <AccountAvatar account={a()} size={18} />}</Show>
        <span class="min-w-0 break-words">{props.value || "—"}</span>
      </div>
    </div>
  );
}

interface TransactionFormProps {
  error: string;
  saving: boolean;
  category: string;
  setCategory: (v: string) => void;
  subcategory: string;
  setSubcategory: (v: string) => void;
  sourceAccount: string;
  setSourceAccount: (v: string) => void;
  destAccount: string;
  setDestAccount: (v: string) => void;
  amount: string;
  setAmount: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  date: string;
  setDate: (v: string) => void;
  isPrivate: boolean;
  setIsPrivate: (v: boolean) => void;
  sharedWith: string[];
  setSharedWith: (v: string[]) => void;
  sharedRoleCodes: string[];
  setSharedRoleCodes: (v: string[]) => void;
  backdateReason: string;
  setBackdateReason: (v: string) => void;
  payee: string;
  setPayee: (v: string) => void;
  payeeId: number | null;
  setPayeeId: (v: number | null) => void;
  refNumber: string;
  setRefNumber: (v: string) => void;
  taxType: string;
  setTaxType: (v: string) => void;
  hasEwt: boolean;
  setHasEwt: (v: boolean) => void;
  ewtRate: string;
  setEwtRate: (v: string) => void;
  payableKind: string;
  setPayableKind: (v: string) => void;
  dueDate: string;
  setDueDate: (v: string) => void;
  chequeNumber: string;
  setChequeNumber: (v: string) => void;
  pdcStatus: string;
  setPdcStatus: (v: string) => void;
  pendingFiles: PendingFile[];
  setPendingFiles: (v: PendingFile[]) => void;
  existingAttachments?: Attachment[];
  onDeleteExistingAttachment?: (attachmentId: number) => Promise<void> | void;
  accounts: FinancialAccount[];
  orgMembers: OrgMember[];
  shareableRoles: ShareableRole[];
  isAdmin: boolean;
  canShare: boolean;
  isBackdated: boolean;
  saleItems: SalesLine[];
  setSaleItems: (v: SalesLine[]) => void;
  saleClient: ClientOption | null;
  setSaleClient: (v: ClientOption | null) => void;
  saleVoucher: VoucherOption | null;
  setSaleVoucher: (v: VoucherOption | null) => void;
  saleManualDiscount: string;
  setSaleManualDiscount: (v: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  onCancel?: () => void;
}

function TransactionForm(props: TransactionFormProps) {
  const catConfig = () => CATEGORY_FORM[props.category] || CATEGORY_FORM.expense;
  const [dragging, setDragging] = createSignal(false);
  const [cameraOpen, setCameraOpen] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<"default" | "advanced">("default");
  const [selectedPayee, setSelectedPayee] = createSignal<PayeeOption | null>(null);
  createEffect(() => {
    const name = props.payee;
    const id = props.payeeId;
    const sel = selectedPayee();
    if (id != null && name && !sel) {
      setSelectedPayee({ id, name, kind: "vendor" });
    } else if (sel && sel.name !== name) {
      setSelectedPayee(null);
    } else if (!name && sel) {
      setSelectedPayee(null);
    }
  });
  let dragCounter = 0;
  let formFileInput: HTMLInputElement | undefined;

  const subcategoryAppliesTo = (): "income" | "expense" | null => {
    if (props.category === "sale") return "income";
    if (props.category === "expense" || props.category === "payable") return "expense";
    return null;
  };
  const [subcategoryOptions] = createResource(subcategoryAppliesTo, async (appliesTo) => {
    if (!appliesTo) return [] as { id: number; name: string }[];
    const res = await fetch(`/api/transactions/subcategories?applies_to=${appliesTo}`, {
      credentials: "include",
    });
    if (!res.ok) return [] as { id: number; name: string }[];
    const data = (await res.json()) as { subcategories: { id: number; name: string }[] };
    return data.subcategories;
  });

  // True once the async resource has resolved at least once. Gates the
  // SearchableSelect mount so the loading-state placeholder shows while the
  // per-org options are still in flight.
  const subcategoryOptionsReady = () => subcategoryOptions() !== undefined;

  function addFiles(files: File[]) {
    const existing = new Set(
      props.pendingFiles.map((pf) => `${pf.file.name}::${pf.file.size}::${pf.file.lastModified}`),
    );
    const deduped = files.filter(
      (f) => !existing.has(`${f.name}::${f.size}::${f.lastModified}`),
    );
    if (deduped.length === 0) return;
    const newPending = deduped.map(createPendingFile);
    props.setPendingFiles([...props.pendingFiles, ...newPending]);
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (e.dataTransfer?.types.includes("Files")) setDragging(true);
  }
  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) setDragging(false);
  }
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    setDragging(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  }
  function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      addFiles(files);
    }
  }

  return (
    <div
      class="relative flex flex-col flex-1 min-h-0"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      <Show when={dragging()}>
        <div class="absolute inset-0 z-30 border-2 border-dashed border-amber-400/60 bg-amber-500/10 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none">
          <Upload size={32} class="text-amber-400 mb-2" />
          <span class="text-sm text-amber-400 font-medium">Drop files to attach</span>
          <span class="text-[10px] text-amber-400/60 mt-1">Images or PDFs</span>
        </div>
      </Show>

      <Show when={cameraOpen()}>
        <CameraCapture
          onCapture={(file) => {
            addFiles([file]);
            setCameraOpen(false);
          }}
          onClose={() => setCameraOpen(false)}
        />
      </Show>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onSubmit();
        }}
        class="flex flex-col flex-1 min-h-0"
      >
        <div class="flex-1 overflow-x-hidden overflow-y-auto px-5 sm:px-6 py-5 space-y-4">
          <Show when={props.error}>
            <div
              class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
              data-testid="transactions-form-error"
            >
              {props.error}
            </div>
          </Show>

          <div>
            <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">Type</div>
            <div class="grid grid-cols-4 gap-2">
              <For each={["expense", "sale", "payable", "business"]}>
                {(cat) => {
                  const cfg = CATEGORY_FORM[cat];
                  const tone = CATEGORY_TONE[cat];
                  const tc = TONE_CLASSES[tone.tone];
                  const Ico = tone.icon;
                  return (
                    <button
                      type="button"
                      data-testid={`transactions-form-category-${cat}`}
                      onClick={() => {
                        props.setCategory(cat);
                        props.setSourceAccount("");
                        props.setDestAccount("");
                      }}
                      class="flex flex-col items-center justify-center gap-1.5 py-4 border transition-all ks-hud-clip-button cursor-pointer active:opacity-80"
                      classList={{
                        [`${tc.bg} ${tc.border} ${tc.text}`]: props.category === cat,
                        "border-zinc-800/60 text-zinc-500 hover:text-zinc-200 hover:border-zinc-700":
                          props.category !== cat,
                      }}
                    >
                      <Ico size={20} />
                      <span class="text-xs font-medium">{cfg.label}</span>
                    </button>
                  );
                }}
              </For>
            </div>
            <p class="text-[11px] text-zinc-500 mt-2">{catConfig().hint}</p>
          </div>

          <Show when={props.category === "sale"}>
            <SalesBodyEditor
              items={props.saleItems}
              setItems={props.setSaleItems}
              client={props.saleClient}
              setClient={props.setSaleClient}
              voucher={props.saleVoucher}
              setVoucher={props.setSaleVoucher}
              manualDiscount={props.saleManualDiscount}
              setManualDiscount={props.setSaleManualDiscount}
            />
          </Show>

          <Show when={!(props.category === "sale" && props.saleItems.length > 0)}>
            <FormField label="Amount *">
              <div class="flex items-center gap-3 px-4 py-3 border bg-zinc-900/60 border-zinc-800/60 ks-hud-clip-button focus-within:border-amber-500/50 transition-colors">
                <span class="text-3xl font-bold text-zinc-500 tabular-nums">₱</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  data-testid="transactions-form-amount"
                  value={props.amount}
                  onInput={(e) => props.setAmount(e.currentTarget.value)}
                  class="flex-1 bg-transparent text-2xl sm:text-3xl font-bold tabular-nums text-zinc-100 placeholder-zinc-700 focus:outline-none"
                  placeholder="0.00"
                  required
                />
              </div>
            </FormField>
          </Show>

          <FormField label="Date *">
            <DatePicker
              value={props.date}
              onChange={(d: string | null) => d && props.setDate(d)}
              disabled={!props.isAdmin}
            />
            <Show when={!props.isAdmin}>
              <p class="text-[10px] text-zinc-600 mt-0.5">Only admins can change the date</p>
            </Show>
          </FormField>

          <Show when={props.isBackdated}>
            <div class="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <FormField label="Backdate Reason *">
                <input
                  type="text"
                  data-testid="transactions-form-backdate-reason"
                  value={props.backdateReason}
                  onInput={(e) => props.setBackdateReason(e.currentTarget.value)}
                  class="w-full rounded-lg border border-amber-500/30 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/50 focus:outline-none"
                  placeholder="Why are you backdating this transaction?"
                  required
                />
              </FormField>
            </div>
          </Show>

          <FormField label="Description *">
            <input
              type="text"
              data-testid="transactions-form-description"
              value={props.description}
              onInput={(e) => props.setDescription(e.currentTarget.value)}
              class="w-full bg-zinc-900/60 border border-zinc-800/60 px-3 py-3 text-sm text-zinc-200 ks-hud-clip-button focus:outline-none focus:border-amber-500/50"
              placeholder={catConfig().descPlaceholder}
              required
            />
          </FormField>

          <Show when={catConfig().showPayee}>
            <div class="grid grid-cols-2 gap-4">
              <FormField label={catConfig().payeeLabel!}>
                <PayeePicker
                  testIdPrefix="form-payee-picker"
                  selected={selectedPayee()}
                  selectedName={props.payee}
                  kind={props.category === "sale" ? "customer" : "vendor"}
                  createAsKind={props.category === "sale" ? "customer" : "vendor"}
                  placeholder={catConfig().payeePlaceholder!}
                  onChange={(p) => {
                    setSelectedPayee(p);
                    props.setPayee(p ? p.name : "");
                    props.setPayeeId(p ? p.id : null);
                  }}
                />
              </FormField>
              <FormField label="Receipt / Ref #">
                <input
                  type="text"
                  value={props.refNumber}
                  onInput={(e) => props.setRefNumber(e.currentTarget.value)}
                  class="w-full bg-zinc-900/60 border border-zinc-800/60 px-3 py-3 text-sm text-zinc-200 ks-hud-clip-button focus:outline-none focus:border-amber-500/50"
                  placeholder="OR#, SI#, or ref number"
                />
              </FormField>
            </div>
          </Show>
          <Show when={!catConfig().showPayee}>
            <FormField label="Reference #">
              <input
                type="text"
                value={props.refNumber}
                onInput={(e) => props.setRefNumber(e.currentTarget.value)}
                class="w-full bg-zinc-900/60 border border-zinc-800/60 px-3 py-3 text-sm text-zinc-200 ks-hud-clip-button focus:outline-none focus:border-amber-500/50"
                placeholder="Reference number (optional)"
              />
            </FormField>
          </Show>

          <Show when={subcategoryAppliesTo() !== null}>
            <FormField label="Category">
              <Show
                when={subcategoryOptionsReady()}
                fallback={
                  <select
                    disabled
                    data-testid="subcategory-select-loading"
                    class="w-full bg-zinc-900/60 border border-zinc-800/60 px-3 py-3 text-sm text-zinc-500 ks-hud-clip-button focus:outline-none"
                  >
                    <option>Loading…</option>
                  </select>
                }
              >
                <SearchableSelect
                  triggerTestId="subcategory-select"
                  wrapperClass="relative w-full"
                  value={props.subcategory}
                  options={(() => {
                    const list = (subcategoryOptions() || []).map((opt) => ({
                      value: opt.name,
                      label: opt.name,
                    }));
                    list.unshift({ value: "", label: "— Uncategorised —" });
                    if (props.subcategory && !list.some((o) => o.value === props.subcategory)) {
                      list.push({ value: props.subcategory, label: props.subcategory });
                    }
                    return list;
                  })()}
                  onChange={(opt: { value: string } | null) =>
                    props.setSubcategory(opt ? String(opt.value) : "")
                  }
                  placeholder="— Uncategorised —"
                  searchPlaceholder="Search categories…"
                  triggerClass="w-full bg-zinc-900/60 border border-zinc-800/60 px-3 py-3 text-sm text-zinc-200 ks-hud-clip-button cursor-pointer focus:outline-none focus:border-amber-500/50 flex items-center justify-between gap-2"
                  triggerLabelClass="truncate text-left flex-1 min-w-0"
                />
              </Show>
              <p class="text-[10px] text-zinc-600 mt-0.5">Optional. Used for tax-prep classification.</p>
            </FormField>
          </Show>

          <Show when={props.category === "payable"}>
            <div class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-3">
              <div class="flex items-center gap-2 text-[10px] uppercase tracking-widest text-amber-400 font-semibold">
                <CalendarDays size={12} />
                <span>Payable details</span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Kind *">
                  <select
                    value={props.payableKind}
                    onChange={(e) => props.setPayableKind(e.currentTarget.value)}
                    class="w-full bg-zinc-900/60 border border-zinc-800/60 px-3 py-3 text-sm text-zinc-200 ks-hud-clip-button cursor-pointer focus:outline-none focus:border-amber-500/50"
                  >
                    <For each={PAYABLE_KIND_OPTIONS}>{(opt) => <option value={opt.id}>{opt.label}</option>}</For>
                  </select>
                </FormField>
                <FormField label="Due date">
                  <DatePicker
                    value={props.dueDate}
                    onChange={(d: string | null) => props.setDueDate(d || "")}
                  />
                  <p class="text-[10px] text-zinc-600 mt-0.5">
                    When payment is owed. Past-due payables show in the Payables tab.
                  </p>
                </FormField>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Cheque number">
                  <input
                    type="text"
                    value={props.chequeNumber}
                    onInput={(e) => props.setChequeNumber(e.currentTarget.value)}
                    class="w-full bg-zinc-900/60 border border-zinc-800/60 px-3 py-3 text-sm text-zinc-200 ks-hud-clip-button focus:outline-none focus:border-amber-500/50"
                    placeholder="e.g. 0004429-007"
                  />
                  <p class="text-[10px] text-zinc-600 mt-0.5">
                    For post-dated cheques (PDC). Leave blank for direct payments.
                  </p>
                </FormField>
                <Show when={props.chequeNumber.trim()}>
                  <FormField label="PDC status">
                    <div class="flex rounded-lg border border-zinc-800/50 overflow-hidden">
                      <For each={PDC_OPTIONS}>
                        {(opt) => (
                          <button
                            type="button"
                            onClick={() => props.setPdcStatus(opt.id)}
                            class="flex-1 px-2 py-2.5 text-[11px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer min-h-[40px] active:opacity-80"
                            classList={{
                              "bg-amber-500/20 text-amber-400": props.pdcStatus === opt.id,
                              "text-zinc-500 hover:text-zinc-300": props.pdcStatus !== opt.id,
                            }}
                          >
                            <span class={`w-1.5 h-1.5 rounded-full ${opt.dot}`} />
                            {opt.label.replace("PDC ", "")}
                          </button>
                        )}
                      </For>
                    </div>
                  </FormField>
                </Show>
              </div>
            </div>
          </Show>

          <Show
            when={catConfig().showSecondAccount}
            fallback={
              <FormField label={catConfig().accountLabel}>
                <AccountPicker
                  accounts={props.accounts}
                  ariaLabel={catConfig().accountLabel}
                  value={props.category === "sale" ? props.destAccount : props.sourceAccount}
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
                <Show when={catConfig().accountHint}>
                  <p class="text-[10px] text-zinc-600 mt-0.5">{catConfig().accountHint}</p>
                </Show>
              </FormField>
            }
          >
            <div class="grid grid-cols-1 gap-4">
              <FormField label={catConfig().accountLabel}>
                <AccountPicker
                  accounts={props.accounts}
                  ariaLabel={catConfig().accountLabel}
                  value={props.sourceAccount}
                  onChange={(v) => props.setSourceAccount(v)}
                  excludeId={props.destAccount}
                />
              </FormField>
              <FormField label={catConfig().secondAccountLabel!}>
                <AccountPicker
                  accounts={props.accounts}
                  ariaLabel={catConfig().secondAccountLabel!}
                  value={props.destAccount}
                  onChange={(v) => props.setDestAccount(v)}
                  excludeId={props.sourceAccount}
                  autoDefault={false}
                />
              </FormField>
            </div>
          </Show>

          <FormField label="Notes">
            <MentionTextarea
              value={props.notes}
              setValue={props.setNotes}
              class="w-full bg-zinc-900/60 border border-zinc-800/60 px-3 py-2 text-sm text-zinc-200 ks-hud-clip-button focus:outline-none focus:border-amber-500/50 resize-none"
              rows={2}
              placeholder="Optional notes... (type @ to mention a client)"
              ariaLabel="Notes"
            />
          </FormField>

          <div>
            <div class="flex items-center gap-1 mb-2 text-xs text-zinc-500">
              <Paperclip size={12} /> Attachments
              <Show when={(props.existingAttachments?.length ?? 0) + props.pendingFiles.length > 0}>
                <span class="text-zinc-600">
                  ({(props.existingAttachments?.length ?? 0) + props.pendingFiles.length})
                </span>
              </Show>
            </div>

            <div class="flex gap-2 overflow-x-auto pt-3 pr-3 pb-2 items-start">
              <For each={props.existingAttachments ?? []}>
                {(att) => (
                  <ExistingAttachmentTile
                    attachment={att}
                    testId="transaction-form-existing-attachment"
                    onDelete={props.onDeleteExistingAttachment}
                  />
                )}
              </For>
              <For each={props.pendingFiles}>
                {(pf) => (
                  <div class="relative group shrink-0">
                    <Show
                      when={pf.previewUrl}
                      fallback={
                        <div class="flex w-24 h-24 flex-col items-center justify-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 text-xs text-zinc-300">
                          <FileIcon size={20} />
                          <span class="truncate max-w-full text-[10px]">{pf.file.name}</span>
                        </div>
                      }
                    >
                      <div class="block rounded-lg border border-zinc-700 overflow-hidden">
                        <img src={pf.previewUrl!} alt={pf.file.name} class="w-24 h-24 object-cover" />
                      </div>
                    </Show>
                    <button
                      type="button"
                      onClick={() => {
                        revokePendingFile(pf);
                        props.setPendingFiles(props.pendingFiles.filter((f) => f.id !== pf.id));
                      }}
                      class="absolute -top-2 -right-2 flex w-7 h-7 items-center justify-center rounded-full bg-red-600/90 border border-red-400/60 text-white cursor-pointer hover:bg-red-500 active:bg-red-700 shadow-lg"
                      aria-label={`Remove ${pf.file.name}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </For>
              <AddAttachmentTile
                uploading={false}
                onPickFile={() => formFileInput?.click()}
                onPickCamera={() => setCameraOpen(true)}
              />
            </div>

            <input
              ref={formFileInput}
              type="file"
              accept="image/*,application/pdf"
              multiple
              class="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  const newFiles = Array.from(e.target.files).map(createPendingFile);
                  props.setPendingFiles([...props.pendingFiles, ...newFiles]);
                  e.target.value = "";
                }
              }}
            />

            <Show when={props.pendingFiles.length === 0}>
              <p class="text-[10px] text-zinc-600 mt-1">Drop files here or paste from clipboard.</p>
            </Show>
          </div>

          <div class="flex justify-center pt-2">
            <button
              type="button"
              onClick={() => setViewMode(viewMode() === "default" ? "advanced" : "default")}
              class="text-xs text-zinc-500 hover:text-amber-400 px-3 py-1.5 transition-colors cursor-pointer"
            >
              {viewMode() === "default" ? "Show advanced fields" : "Hide advanced fields"}
            </button>
          </div>

          <Show when={viewMode() === "advanced"}>
            <div
              data-testid="advanced-fields-container"
              class="rounded-lg border border-zinc-700/60 bg-zinc-900/40 p-3 space-y-3"
            >
              <div class="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">
                <span>Advanced</span>
              </div>

              <div class="rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-3">
                <FormField label="Tax">
                  <div class="flex rounded-lg border border-zinc-800/50 overflow-hidden">
                    <For
                      each={
                        [
                          ["vat_inclusive", "VAT Incl."],
                          ["vat_exclusive", "VAT Excl."],
                          ["vat_exempt", "Exempt"],
                          ["non_vat", "Non-VAT"],
                        ] as [string, string][]
                      }
                    >
                      {([key, label]) => (
                        <button
                          type="button"
                          onClick={() => props.setTaxType(key)}
                          class="flex-1 px-2 py-2.5 text-xs transition-colors cursor-pointer min-h-[40px] active:opacity-80"
                          classList={{
                            "bg-amber-500/20 text-amber-400": props.taxType === key,
                            "text-zinc-600 hover:text-zinc-400": props.taxType !== key,
                          }}
                        >
                          {label}
                        </button>
                      )}
                    </For>
                  </div>
                </FormField>
                <Show
                  when={
                    props.amount &&
                    parseFloat(props.amount) > 0 &&
                    (props.taxType === "vat_inclusive" || props.taxType === "vat_exclusive")
                  }
                >
                  {(() => {
                    const amt = parseFloat(props.amount);
                    const sub =
                      props.taxType === "vat_inclusive" ? Math.round((amt / 1.12) * 100) / 100 : amt;
                    const vat =
                      props.taxType === "vat_inclusive"
                        ? Math.round((amt - sub) * 100) / 100
                        : Math.round(amt * 0.12 * 100) / 100;
                    const total = props.taxType === "vat_exclusive" ? sub + vat : amt;
                    return (
                      <div class="mt-2 text-xs text-zinc-500 space-y-0.5 border-t border-zinc-800/50 pt-2">
                        <div class="flex justify-between">
                          <span>VATtable Sales</span>
                          <span>{formatCurrency(sub)}</span>
                        </div>
                        <div class="flex justify-between">
                          <span>VAT (12%)</span>
                          <span>{formatCurrency(vat)}</span>
                        </div>
                        <div class="flex justify-between font-medium text-zinc-300">
                          <span>Total</span>
                          <span>{formatCurrency(total)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </Show>

                <Show when={props.category === "expense" || props.category === "payable"}>
                  <div class="mt-3 border-t border-zinc-800/50 pt-3">
                    <label class="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={props.hasEwt}
                        onChange={(e) => props.setHasEwt(e.currentTarget.checked)}
                        class="h-4 w-4 accent-amber-500 cursor-pointer"
                      />
                      <span>Has Expanded Withholding Tax</span>
                    </label>
                    <Show when={props.hasEwt}>
                      <div class="mt-2 space-y-2">
                        <FormField label="EWT rate (%)">
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max="100"
                            value={props.ewtRate}
                            onInput={(e) => props.setEwtRate(e.currentTarget.value)}
                            class="w-full px-3 py-2 bg-zinc-900/50 border border-zinc-800 text-zinc-100 text-sm rounded-md focus:outline-none focus:border-amber-500/50"
                            placeholder="e.g. 1, 2, 5, 10, 15"
                          />
                        </FormField>
                        <Show
                          when={
                            props.amount &&
                            parseFloat(props.amount) > 0 &&
                            props.ewtRate &&
                            parseFloat(props.ewtRate) > 0
                          }
                        >
                          {(() => {
                            const amt = parseFloat(props.amount);
                            const rate = parseFloat(props.ewtRate);
                            const ewt = Math.round(amt * rate) / 100;
                            return (
                              <div class="text-xs text-zinc-500 border-t border-zinc-800/50 pt-2">
                                <div class="flex justify-between">
                                  <span>EWT ({rate}%)</span>
                                  <span>{formatCurrency(ewt)}</span>
                                </div>
                              </div>
                            );
                          })()}
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>

              <div
                class="rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-4 relative"
                classList={{ "opacity-60": !props.canShare }}
                title={
                  props.canShare
                    ? undefined
                    : "Sharing private transactions requires the members.list_basic permission."
                }
              >
                <div class="flex items-center justify-between min-h-[44px]">
                  <div class="flex items-center gap-2">
                    <Lock size={14} class="text-zinc-500" />
                    <div>
                      <span class="text-sm text-zinc-300">Private transaction</span>
                      <p class="text-[10px] text-zinc-600">
                        {props.canShare
                          ? "Hidden from others unless shared"
                          : "Locked — needs members.list_basic permission"}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!props.canShare}
                    onClick={() => {
                      if (!props.canShare) return;
                      props.setIsPrivate(!props.isPrivate);
                    }}
                    class="ks-theme-toggle shrink-0"
                    classList={{ "cursor-not-allowed": !props.canShare }}
                  >
                    <span class="ks-theme-toggle-track" data-active={props.isPrivate ? "" : undefined}>
                      <span class="ks-theme-toggle-icon ks-theme-toggle-icon-moon">
                        <Lock size={12} />
                      </span>
                      <span class="ks-theme-toggle-icon ks-theme-toggle-icon-sun">
                        <Lock size={12} />
                      </span>
                    </span>
                  </button>
                </div>

                <Show when={props.isPrivate && props.canShare}>
                  <div class="mt-4 pt-3 border-t border-zinc-800/50">
                    <p class="text-[10px] text-zinc-500 mb-3">
                      Always visible to:{" "}
                      <span class="text-zinc-400">you (creator), org admins, superusers</span>
                    </p>

                    <span class="text-xs text-zinc-500 block mb-2">Share with role</span>
                    <div class="flex gap-2 mb-3 flex-wrap">
                      <For each={props.shareableRoles}>
                        {(role) => {
                          const members = () => (Array.isArray(props.orgMembers) ? props.orgMembers : []);
                          const membersInRole = () => members().filter((m) => m.role === role.code);
                          const selected = () => props.sharedRoleCodes.includes(role.code);
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                if (selected()) {
                                  props.setSharedRoleCodes(
                                    props.sharedRoleCodes.filter((c) => c !== role.code),
                                  );
                                } else {
                                  const roleMemberIds = membersInRole().map((m) => m.user_id);
                                  props.setSharedWith(
                                    props.sharedWith.filter((id) => !roleMemberIds.includes(id)),
                                  );
                                  props.setSharedRoleCodes([...props.sharedRoleCodes, role.code]);
                                }
                              }}
                              class="px-3 py-2 text-xs rounded-lg border cursor-pointer min-h-[36px] capitalize transition-colors active:opacity-80"
                              classList={{
                                "border-amber-500/40 bg-amber-500/10 text-amber-400": selected(),
                                "border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600":
                                  !selected(),
                              }}
                            >
                              All {role.label}s
                              <Show when={membersInRole().length > 0}>
                                <span class="text-zinc-600 ml-1">({membersInRole().length})</span>
                              </Show>
                            </button>
                          );
                        }}
                      </For>
                    </div>

                    <span class="text-xs text-zinc-500 block mb-2">Or select people</span>
                    <div class="space-y-0.5 max-h-[150px] overflow-y-auto">
                      <For
                        each={(Array.isArray(props.orgMembers) ? props.orgMembers : []).filter(
                          (m) => m.role !== "admin",
                        )}
                      >
                        {(m) => {
                          const coveringRole = () =>
                            props.shareableRoles.find(
                              (r) => r.code === m.role && props.sharedRoleCodes.includes(r.code),
                            );
                          const checked = () =>
                            props.sharedWith.includes(m.user_id) || !!coveringRole();
                          return (
                            <label
                              class="flex items-center gap-3 text-sm py-2 px-2 rounded-lg min-h-[40px] transition-colors"
                              classList={{
                                "text-zinc-300 cursor-pointer hover:bg-zinc-800/30 active:bg-zinc-800/50":
                                  !coveringRole(),
                                "text-zinc-500 cursor-not-allowed bg-zinc-900/40": !!coveringRole(),
                              }}
                            >
                              <div
                                class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors"
                                classList={{
                                  "border-amber-500 bg-amber-500": checked() && !coveringRole(),
                                  "border-amber-500/40 bg-amber-500/40": checked() && !!coveringRole(),
                                  "border-zinc-600 bg-transparent": !checked(),
                                }}
                              >
                                <Show when={checked()}>
                                  <svg
                                    class="w-3 h-3 text-zinc-900"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    stroke-width="3"
                                  >
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                </Show>
                              </div>
                              <input
                                type="checkbox"
                                checked={checked()}
                                disabled={!!coveringRole()}
                                onChange={(e) => {
                                  if (coveringRole()) return;
                                  if (e.target.checked) {
                                    props.setSharedWith([...props.sharedWith, m.user_id]);
                                  } else {
                                    props.setSharedWith(props.sharedWith.filter((id) => id !== m.user_id));
                                  }
                                }}
                                class="sr-only"
                              />
                              <span class="flex-1">{m.name}</span>
                              <Show
                                when={coveringRole()}
                                fallback={<span class="text-[10px] text-zinc-600 capitalize">{m.role}</span>}
                              >
                                <span class="text-[10px] text-amber-500/70">
                                  via All {coveringRole()!.label}s
                                </span>
                              </Show>
                            </label>
                          );
                        }}
                      </For>
                      <Show when={!Array.isArray(props.orgMembers) || props.orgMembers.length === 0}>
                        <p class="text-xs text-zinc-600 py-2">Loading members...</p>
                      </Show>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        </div>

        <div class="px-5 sm:px-6 py-4 border-t border-zinc-800/60 bg-zinc-950 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
          <div class="text-xs text-zinc-500">
            <span class="text-zinc-600">Will record as </span>
            <span
              class="font-bold"
              classList={{
                "text-emerald-400": props.category === "sale",
                "text-red-400": props.category === "expense",
                "text-amber-400": props.category === "payable",
                "text-blue-400": props.category === "business",
              }}
            >
              {(CATEGORY_FORM[props.category] || CATEGORY_FORM.expense).label}
            </span>
          </div>
          <div class="flex justify-end gap-3">
            <Show when={props.onCancel}>
              <Button intent="secondary" variant="ghost" onClick={props.onCancel} disabled={props.saving}>
                Cancel
              </Button>
            </Show>
            <Button
              intent="primary"
              variant="clip1"
              type="submit"
              disabled={props.saving}
              data-testid="transactions-form-submit"
            >
              {props.saving ? "Saving..." : props.submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function FormField(props: { label: string; children: JSX.Element }) {
  return (
    <div>
      <label class="block text-xs text-zinc-500 mb-1">{props.label}</label>
      {props.children}
    </div>
  );
}
