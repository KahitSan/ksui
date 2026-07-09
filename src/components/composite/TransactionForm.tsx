// The transaction create/edit form: category type picker, SalesBodyEditor mount,
// amount/date/backdate/description, PayeePicker + ref number, subcategory
// createResource + SearchableSelect, payable-details pane, AccountRadioPicker
// wiring, notes, attachments drag/drop/paste/camera + pending-file tiles,
// footer. The advanced fields live in FormAdvancedSection, gated here by the
// `viewMode === "advanced"` <Show>. `simpleMode` hides the Type picker and the
// advanced-fields toggle entirely, for a caller that locks `category` to one
// value and never needs EWT/sharing (e.g. a "record my own expense" surface).

import {
  createEffect,
  createResource,
  createSignal,
  Show,
  For,
} from "solid-js";
import X from "lucide-solid/icons/x";
import Upload from "lucide-solid/icons/upload";
import FileIcon from "lucide-solid/icons/file";
import CalendarDays from "lucide-solid/icons/calendar-days";
import Paperclip from "lucide-solid/icons/paperclip";
import Store from "lucide-solid/icons/store";
import ArrowDownLeft from "lucide-solid/icons/arrow-down-left";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import ArrowRightLeft from "lucide-solid/icons/arrow-right-left";

import AccountRadioPicker from "./AccountRadioPicker";
import FormAdvancedSection from "./FormAdvancedSection";
import SalesBodyEditor, { type SalesLine } from "./SalesBodyEditor";
import TransferFeeChip from "./TransferFeeChip";
import TransferAccountsPicker from "./TransferAccountsPicker";
import ComboBox from "./ComboBox";
import type { ClientOption, PayeeOption, PayeeKind } from "./picker-types";
import VoucherPicker, { type VoucherOption } from "./VoucherPicker";
import MentionTextarea from "./MentionTextarea";
import SearchableSelect from "./SearchableSelect";
import type { PaymentAccountOption } from "./PaymentAccountPicker";
import CameraCapture from "../base/CameraCapture";
import AddAttachmentTile from "../base/AddAttachmentTile";
import ExistingAttachmentTile, {
  type ExistingAttachment,
} from "../base/ExistingAttachmentTile";
import FormField from "../base/FormField";
import DatePicker from "../base/DatePicker";
import Button from "../base/Button";
import SegmentedFilter from "../base/SegmentedFilter";
import {
  type PendingFile,
  createPendingFile,
  revokePendingFile,
} from "../../utils/pending-file";

export type TransactionAccount = PaymentAccountOption & {
  balance?: number | string | null;
};

export interface TransactionOrgMember {
  user_id: string;
  name: string;
  role: string;
}

export interface TransactionShareableRole {
  code: string;
  label: string;
}

export type TransactionAttachment = ExistingAttachment;

// Payee data-wiring for the generic ComboBox engine. Search/create hit the
// host app's /api/payees endpoint directly; `kind` is "customer" for sales
// and "vendor" otherwise. Degrades gracefully — a missing payees endpoint
// surfaces a notice and the free-text fallback (selectedName) still works.
async function searchPayees(
  query: string,
  kind: PayeeKind
): Promise<PayeeOption[]> {
  const params = new URLSearchParams({ status: "active", limit: "20", kind });
  if (query) params.set("search", query);
  const r = await fetch(`/api/payees?${params.toString()}`, {
    credentials: "include",
  });
  if (!r.ok) {
    if (r.status === 403) throw new Error("Permission denied");
    if (r.status === 404)
      throw new Error("Payees module isn't available — type a name instead");
    throw new Error("Failed to load");
  }
  const json = (await r.json()) as { data?: PayeeOption[] };
  return json.data ?? [];
}

async function createPayee(
  name: string,
  kind: PayeeKind
): Promise<PayeeOption> {
  const res = await fetch("/api/payees", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, kind }),
  });
  if (!res.ok && res.status !== 200) {
    const body = (await res
      .json()
      .catch(() => ({ error: "Failed to create payee" }))) as {
      error?: string;
    };
    throw new Error(body.error || "Failed to create payee");
  }
  return (await res.json()) as PayeeOption;
}

function payeeSecondary(p: PayeeOption): string | null {
  if (!p.default_subcategory && p.kind === "vendor") return null;
  return (
    [p.kind === "vendor" ? null : p.kind, p.default_subcategory]
      .filter(Boolean)
      .join(" · ") || null
  );
}

type IconComponent = (props: { size?: number; class?: string }) => import("solid-js").JSX.Element;

const CATEGORY_TONE: Record<
  string,
  { tone: "emerald" | "red" | "blue" | "amber"; icon: IconComponent }
> = {
  sale: { tone: "emerald", icon: ArrowDownLeft },
  expense: { tone: "red", icon: ArrowUpRight },
  payable: { tone: "amber", icon: CalendarDays },
  business: { tone: "blue", icon: ArrowRightLeft },
};

const TONE_CLASSES: Record<
  "emerald" | "red" | "blue" | "amber",
  { bg: string; text: string; border: string }
> = {
  emerald: {
    bg: "bg-[color-mix(in_srgb,var(--ks-success,#10b981)_10%,transparent)]",
    text: "text-[var(--ks-success-fg,#34d399)]",
    border: "border-[color-mix(in_srgb,var(--ks-success,#10b981)_30%,transparent)]",
  },
  red: {
    bg: "bg-[color-mix(in_srgb,var(--ks-danger,#ef4444)_10%,transparent)]",
    text: "text-[var(--ks-danger-fg,#f87171)]",
    border: "border-[color-mix(in_srgb,var(--ks-danger,#ef4444)_30%,transparent)]",
  },
  blue: {
    bg: "bg-[color-mix(in_srgb,var(--ks-info,#38bdf8)_10%,transparent)]",
    text: "text-[var(--ks-info,#38bdf8)]",
    border: "border-[color-mix(in_srgb,var(--ks-info,#38bdf8)_30%,transparent)]",
  },
  amber: {
    bg: "bg-[color-mix(in_srgb,var(--ks-accent,#fbbf24)_10%,transparent)]",
    text: "text-[var(--ks-accent,#fbbf24)]",
    border: "border-[color-mix(in_srgb,var(--ks-accent,#fbbf24)_30%,transparent)]",
  },
};

const PAYABLE_KIND_OPTIONS: { id: string; label: string }[] = [
  { id: "subscription", label: "Subscription" },
  { id: "utility", label: "Utility" },
  { id: "rent", label: "Rent / Lease" },
  { id: "loan", label: "Loan" },
  { id: "tax", label: "Tax" },
  { id: "other", label: "Other" },
];

const PDC_OPTIONS: { id: string; label: string; dot: string }[] = [
  { id: "issued", label: "PDC issued", dot: "bg-[var(--ks-accent,#fbbf24)]" },
  { id: "presented", label: "PDC presented", dot: "bg-[var(--ks-info,#38bdf8)]" },
  { id: "cleared", label: "PDC cleared", dot: "bg-[var(--ks-success-fg,#34d399)]" },
  { id: "bounced", label: "PDC bounced", dot: "bg-[var(--ks-danger-fg,#f87171)]" },
];

const CATEGORY_FORM: Record<
  string,
  {
    label: string;
    hint: string;
    descPlaceholder: string;
    accountLabel: string;
    accountHint: string;
    showSecondAccount: boolean;
    secondAccountLabel?: string;
    payeeLabel?: string;
    payeePlaceholder?: string;
    showPayee: boolean;
  }
> = {
  expense: {
    label: "Expense",
    hint: "Money going out -- paying for supplies, bills, services",
    descPlaceholder: 'What did you pay for? e.g. "Office supplies"',
    accountLabel: "Paid from",
    accountHint: "Which account was used to pay?",
    showSecondAccount: false,
    payeeLabel: "Paid to",
    payeePlaceholder: 'Store or vendor name, e.g. "Jollibee Magsaysay"',
    showPayee: true,
  },
  sale: {
    label: "Income",
    hint: "Money coming in -- payment received from a customer, client, or other source",
    descPlaceholder: 'What came in? e.g. "Day pass - Walk-in"',
    accountLabel: "Received in",
    accountHint: "Where did the payment go?",
    showSecondAccount: false,
    payeeLabel: "Received from",
    payeePlaceholder: "Customer name (optional)",
    showPayee: true,
  },
  business: {
    label: "Transfer",
    hint: "Moving money between your own accounts",
    descPlaceholder: 'Why? e.g. "Replenish petty cash from bank"',
    accountLabel: "From account",
    accountHint: "",
    showSecondAccount: true,
    secondAccountLabel: "To account",
    showPayee: false,
  },
  payable: {
    label: "Payable",
    hint: "Recurring or scheduled payment -- subscription, utility, rent, loan, tax",
    descPlaceholder: 'What is it? e.g. "Office rent -- May"',
    accountLabel: "Funding account",
    accountHint: "Which account will be debited when this is paid?",
    showSecondAccount: false,
    payeeLabel: "Payable to",
    payeePlaceholder: 'Vendor or biller name, e.g. "MERALCO"',
    showPayee: true,
  },
};

export interface TransactionFormProps {
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
  transferFeeEnabled: boolean;
  setTransferFeeEnabled: (v: boolean) => void;
  transferFeeAmount: string;
  setTransferFeeAmount: (v: string) => void;
  allowTransferFee: boolean;
  pendingFiles: PendingFile[];
  setPendingFiles: (v: PendingFile[]) => void;
  existingAttachments?: TransactionAttachment[];
  onDeleteExistingAttachment?: (attachmentId: number) => Promise<void> | void;
  accounts: TransactionAccount[];
  orgMembers: TransactionOrgMember[];
  shareableRoles: TransactionShareableRole[];
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
  /** Hides the Type picker and the advanced-fields toggle/section entirely.
   *  For a caller that locks `category` to one value and never needs
   *  EWT/sharing (e.g. a "record my own expense" surface). */
  simpleMode?: boolean;
}

export default function TransactionForm(props: TransactionFormProps) {
  const catConfig = () =>
    CATEGORY_FORM[props.category] || CATEGORY_FORM.expense;
  const [dragging, setDragging] = createSignal(false);
  const [cameraOpen, setCameraOpen] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<"default" | "advanced">(
    "default"
  );
  const [selectedPayee, setSelectedPayee] = createSignal<PayeeOption | null>(
    null
  );
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
    if (props.category === "expense" || props.category === "payable")
      return "expense";
    return null;
  };
  const [subcategoryOptions] = createResource(
    subcategoryAppliesTo,
    async (appliesTo) => {
      if (!appliesTo) return [] as { id: number; name: string }[];
      const res = await fetch(
        `/api/transactions/subcategories?applies_to=${appliesTo}`,
        {
          credentials: "include",
        }
      );
      if (!res.ok) return [] as { id: number; name: string }[];
      const data = (await res.json()) as {
        subcategories: { id: number; name: string }[];
      };
      return data.subcategories;
    }
  );

  // True once the async resource has resolved at least once. Gates the
  // SearchableSelect mount so the loading-state placeholder shows while the
  // per-tenant options are still in flight.
  const subcategoryOptionsReady = () => subcategoryOptions() !== undefined;
  const categoryOptions = () =>
    props.category === "payable"
      ? ["sale", "expense", "business", "payable"]
      : ["sale", "expense", "business"];

  createEffect(() => {
    if (props.category !== "business" && props.transferFeeEnabled) {
      props.setTransferFeeEnabled(false);
      props.setTransferFeeAmount("");
    }
  });

  function addFiles(files: File[]) {
    const existing = new Set(
      props.pendingFiles.map(
        (pf) => `${pf.file.name}::${pf.file.size}::${pf.file.lastModified}`
      )
    );
    const deduped = files.filter(
      (f) => !existing.has(`${f.name}::${f.size}::${f.lastModified}`)
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
        <div class="absolute inset-0 z-30 border-2 border-dashed border-[color-mix(in_srgb,var(--ks-accent,#fbbf24)_60%,transparent)] bg-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_10%,transparent)] backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none">
          <Upload size={32} class="text-[var(--ks-accent,#fbbf24)] mb-2" />
          <span class="text-sm text-[var(--ks-accent,#fbbf24)] font-medium">
            Drop files to attach
          </span>
          <span class="text-[10px] text-[color-mix(in_srgb,var(--ks-accent,#fbbf24)_60%,transparent)] mt-1">Images or PDFs</span>
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
              class="rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] px-3 py-2 text-sm text-[var(--ks-danger-fg,#f87171)]"
              data-testid="transactions-form-error"
            >
              {props.error}
            </div>
          </Show>

          <Show when={!props.simpleMode}>
            <div>
              <div class="text-[10px] uppercase tracking-widest text-[var(--ks-fg-subtle,#71717a)] font-semibold mb-2">
                Type
              </div>
              <div
                class="grid gap-2"
                classList={{
                  "grid-cols-3": categoryOptions().length === 3,
                  "grid-cols-4": categoryOptions().length === 4,
                }}
              >
                <For each={categoryOptions()}>
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
                          if (cat !== "business") {
                            props.setTransferFeeEnabled(false);
                            props.setTransferFeeAmount("");
                          }
                        }}
                        class="flex min-h-[42px] items-center justify-center gap-2 px-3 py-2 border text-sm transition-colors ks-hud-clip-button cursor-pointer active:opacity-80"
                        classList={{
                          [`${tc.bg} ${tc.border} ${tc.text}`]:
                            props.category === cat,
                          "border-[#27272a] bg-transparent text-[var(--ks-fg-subtle,#71717a)] hover:border-[var(--ks-input-border,#3f3f46)] hover:text-[#e4e4e7]":
                            props.category !== cat,
                        }}
                      >
                        <Ico size={16} />
                        <span class="font-medium">{cfg.label}</span>
                      </button>
                    );
                  }}
                </For>
              </div>
              <p class="text-[11px] text-[var(--ks-fg-subtle,#71717a)] mt-2">{catConfig().hint}</p>
            </div>
          </Show>

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

          <Show
            when={!(props.category === "sale" && props.saleItems.length > 0)}
          >
            <FormField label="Amount *">
              <div class="flex items-stretch gap-2 px-4 py-3 border bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_60%,transparent)] border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] ks-hud-clip-button focus-within:border-[color-mix(in_srgb,var(--ks-focus-ring,#c9a961)_50%,transparent)] transition-colors">
                <span class="self-center text-3xl font-bold text-[var(--ks-fg-subtle,#71717a)] tabular-nums">
                  ₱
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  data-testid="transactions-form-amount"
                  value={props.amount}
                  onInput={(e) => props.setAmount(e.currentTarget.value)}
                  class="min-w-0 flex-1 bg-transparent text-2xl sm:text-3xl font-bold tabular-nums text-[#f4f4f5] placeholder-[var(--ks-input-border,#3f3f46)] focus:outline-none"
                  placeholder="0.00"
                  required
                />
                <Show
                  when={props.category === "business" && props.allowTransferFee}
                >
                  <TransferFeeChip
                    enabled={props.transferFeeEnabled}
                    onToggle={() => {
                      const next = !props.transferFeeEnabled;
                      props.setTransferFeeEnabled(next);
                      if (!next) props.setTransferFeeAmount("");
                    }}
                  />
                </Show>
              </div>
            </FormField>
            <Show
              when={
                props.category === "business" &&
                props.allowTransferFee &&
                props.transferFeeEnabled
              }
            >
              <div
                class="animate-[fin-slide-fade-down_0.28s_ease-out]"
                data-testid="transactions-form-transfer-fee-field"
              >
                <FormField label="Transfer fee *">
                  <div class="flex items-center gap-2 px-3 py-2 border bg-[color-mix(in_srgb,var(--ks-bg,#0a0a0a)_50%,transparent)] border-[color-mix(in_srgb,var(--ks-info,#38bdf8)_30%,transparent)] ks-hud-clip-button focus-within:border-[color-mix(in_srgb,var(--ks-info,#38bdf8)_60%,transparent)] transition-colors">
                    <span class="text-lg font-bold text-[var(--ks-fg-subtle,#71717a)] tabular-nums">
                      ₱
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      data-testid="transactions-form-transfer-fee-amount"
                      value={props.transferFeeAmount}
                      onInput={(e) =>
                        props.setTransferFeeAmount(e.currentTarget.value)
                      }
                      class="min-w-0 flex-1 bg-transparent text-lg font-semibold tabular-nums text-[#f4f4f5] placeholder-[var(--ks-input-border,#3f3f46)] focus:outline-none"
                      placeholder="0.00"
                    />
                  </div>
                  <p class="mt-1 text-[10px] text-[var(--ks-fg-subtle,#71717a)]">
                    Saved as a separate expense from the source account.
                  </p>
                </FormField>
              </div>
            </Show>
          </Show>

          <FormField label="Date *">
            <DatePicker
              value={props.date}
              onChange={(d: string | null) => d && props.setDate(d)}
              disabled={!props.isAdmin}
            />
            <Show when={!props.isAdmin}>
              <p class="text-[10px] text-[var(--ks-fg-subtle,#71717a)] mt-0.5">
                Only admins can change the date
              </p>
            </Show>
          </FormField>

          <Show when={props.isBackdated}>
            <div class="rounded-lg border border-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_20%,transparent)] bg-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_5%,transparent)] px-3 py-2">
              <FormField label="Backdate Reason *">
                <input
                  type="text"
                  data-testid="transactions-form-backdate-reason"
                  value={props.backdateReason}
                  onInput={(e) =>
                    props.setBackdateReason(e.currentTarget.value)
                  }
                  class="w-full rounded-lg border border-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_30%,transparent)] bg-[var(--ks-border,rgba(39,39,42,0.5))] px-3 py-2 text-sm text-[var(--ks-fg,#ffffff)] focus:border-[color-mix(in_srgb,var(--ks-focus-ring,#c9a961)_50%,transparent)] focus:outline-none"
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
              class="w-full bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_60%,transparent)] border border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] px-3 py-3 text-sm text-[var(--ks-fg,#ffffff)] ks-hud-clip-button focus:outline-none focus:border-[color-mix(in_srgb,var(--ks-focus-ring,#c9a961)_50%,transparent)]"
              placeholder={catConfig().descPlaceholder}
              required
            />
          </FormField>

          <Show when={catConfig().showPayee}>
            <div class="grid grid-cols-2 gap-4">
              <FormField label={catConfig().payeeLabel!}>
                <ComboBox<PayeeOption>
                  testIdPrefix="form-payee-picker"
                  selected={selectedPayee()}
                  selectedName={props.payee}
                  search={(q) =>
                    searchPayees(
                      q,
                      props.category === "sale" ? "customer" : "vendor"
                    )
                  }
                  onCreate={(name) =>
                    createPayee(
                      name,
                      props.category === "sale" ? "customer" : "vendor"
                    )
                  }
                  idOf={(p) => p.id}
                  labelOf={(p) => p.name}
                  secondaryOf={payeeSecondary}
                  icon={Store}
                  noun="payee"
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
                  class="w-full bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_60%,transparent)] border border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] px-3 py-3 text-sm text-[var(--ks-fg,#ffffff)] ks-hud-clip-button focus:outline-none focus:border-[color-mix(in_srgb,var(--ks-focus-ring,#c9a961)_50%,transparent)]"
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
                class="w-full bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_60%,transparent)] border border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] px-3 py-3 text-sm text-[var(--ks-fg,#ffffff)] ks-hud-clip-button focus:outline-none focus:border-[color-mix(in_srgb,var(--ks-focus-ring,#c9a961)_50%,transparent)]"
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
                    class="w-full bg-[rgba(24,24,27,0.6)] border border-[rgba(39,39,42,0.6)] px-3 py-3 text-sm text-[var(--ks-fg-subtle,#71717a)] ks-hud-clip-button focus:outline-none"
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
                    if (
                      props.subcategory &&
                      !list.some((o) => o.value === props.subcategory)
                    ) {
                      list.push({
                        value: props.subcategory,
                        label: props.subcategory,
                      });
                    }
                    return list;
                  })()}
                  onChange={(opt) =>
                    props.setSubcategory(opt ? String(opt.value) : "")
                  }
                  placeholder="— Uncategorised —"
                  searchPlaceholder="Search categories…"
                  triggerClass="w-full bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_60%,transparent)] border border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] px-3 py-3 text-sm text-[var(--ks-fg,#ffffff)] ks-hud-clip-button cursor-pointer focus:outline-none focus:border-[color-mix(in_srgb,var(--ks-focus-ring,#c9a961)_50%,transparent)] flex items-center justify-between gap-2"
                  triggerLabelClass="truncate text-left flex-1 min-w-0"
                />
              </Show>
              <p class="text-[10px] text-[var(--ks-fg-subtle,#71717a)] mt-0.5">
                Optional. Used for tax-prep classification.
              </p>
            </FormField>
          </Show>

          <Show when={props.category === "payable"}>
            <div class="rounded-lg border border-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_20%,transparent)] bg-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_5%,transparent)] p-3 space-y-3">
              <div class="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--ks-accent,#fbbf24)] font-semibold">
                <CalendarDays size={12} />
                <span>Payable details</span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Kind *">
                  <select
                    value={props.payableKind}
                    onChange={(e) =>
                      props.setPayableKind(e.currentTarget.value)
                    }
                    class="w-full bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_60%,transparent)] border border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] px-3 py-3 text-sm text-[var(--ks-fg,#ffffff)] ks-hud-clip-button cursor-pointer focus:outline-none focus:border-[color-mix(in_srgb,var(--ks-focus-ring,#c9a961)_50%,transparent)]"
                  >
                    <For each={PAYABLE_KIND_OPTIONS}>
                      {(opt) => <option value={opt.id}>{opt.label}</option>}
                    </For>
                  </select>
                </FormField>
                <FormField label="Due date">
                  <DatePicker
                    value={props.dueDate}
                    onChange={(d: string | null) => props.setDueDate(d || "")}
                  />
                  <p class="text-[10px] text-[var(--ks-fg-subtle,#71717a)] mt-0.5">
                    When payment is owed. Past-due payables show in the Payables
                    tab.
                  </p>
                </FormField>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Cheque number">
                  <input
                    type="text"
                    value={props.chequeNumber}
                    onInput={(e) =>
                      props.setChequeNumber(e.currentTarget.value)
                    }
                    class="w-full bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_60%,transparent)] border border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] px-3 py-3 text-sm text-[var(--ks-fg,#ffffff)] ks-hud-clip-button focus:outline-none focus:border-[color-mix(in_srgb,var(--ks-focus-ring,#c9a961)_50%,transparent)]"
                    placeholder="e.g. 0004429-007"
                  />
                  <p class="text-[10px] text-[var(--ks-fg-subtle,#71717a)] mt-0.5">
                    For post-dated cheques (PDC). Leave blank for direct
                    payments.
                  </p>
                </FormField>
                <Show when={props.chequeNumber.trim()}>
                  <FormField label="PDC status">
                    <SegmentedFilter
                      options={PDC_OPTIONS.map((opt) => ({
                        value: opt.id,
                        label: opt.label.replace("PDC ", ""),
                      }))}
                      value={props.pdcStatus}
                      onChange={props.setPdcStatus}
                    />
                  </FormField>
                </Show>
              </div>
            </div>
          </Show>

          <Show
            when={catConfig().showSecondAccount}
            fallback={
              <FormField label={catConfig().accountLabel}>
                <AccountRadioPicker
                  accounts={props.accounts}
                  ariaLabel={catConfig().accountLabel}
                  value={
                    props.category === "sale"
                      ? props.destAccount
                      : props.sourceAccount
                  }
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
                  <p class="text-[10px] text-[var(--ks-fg-subtle,#71717a)] mt-0.5">
                    {catConfig().accountHint}
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
              sourceLabel={catConfig().accountLabel}
              destLabel={catConfig().secondAccountLabel!}
              amount={props.amount}
              feeAmount={props.transferFeeAmount}
              feeEnabled={props.transferFeeEnabled && props.allowTransferFee}
            />
          </Show>

          <FormField label="Notes">
            <MentionTextarea
              value={props.notes}
              setValue={props.setNotes}
              class="w-full bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_60%,transparent)] border border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] px-3 py-2 text-sm text-[var(--ks-fg,#ffffff)] ks-hud-clip-button focus:outline-none focus:border-[color-mix(in_srgb,var(--ks-focus-ring,#c9a961)_50%,transparent)] resize-none"
              rows={2}
              placeholder="Optional notes... (type @ to mention a client)"
              ariaLabel="Notes"
            />
          </FormField>

          <div>
            <div class="flex items-center gap-1 mb-2 text-xs text-[var(--ks-fg-subtle,#71717a)]">
              <Paperclip size={12} /> Attachments
              <Show
                when={
                  (props.existingAttachments?.length ?? 0) +
                    props.pendingFiles.length >
                  0
                }
              >
                <span class="text-[var(--ks-fg-subtle,#71717a)]">
                  (
                  {(props.existingAttachments?.length ?? 0) +
                    props.pendingFiles.length}
                  )
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
                        <div class="flex w-24 h-24 flex-col items-center justify-center gap-1 rounded-lg border border-[var(--ks-input-border,#3f3f46)] bg-[rgba(39,39,42,0.5)] px-2 text-xs text-[#d4d4d8]">
                          <FileIcon size={20} />
                          <span class="truncate max-w-full text-[10px]">
                            {pf.file.name}
                          </span>
                        </div>
                      }
                    >
                      <div class="block rounded-lg border border-[var(--ks-input-border,#3f3f46)] overflow-hidden">
                        <img
                          src={pf.previewUrl!}
                          alt={pf.file.name}
                          class="w-24 h-24 object-cover"
                        />
                      </div>
                    </Show>
                    <button
                      type="button"
                      onClick={() => {
                        revokePendingFile(pf);
                        props.setPendingFiles(
                          props.pendingFiles.filter((f) => f.id !== pf.id)
                        );
                      }}
                      class="absolute -top-2 -right-2 flex w-7 h-7 items-center justify-center rounded-full bg-[rgba(220,38,38,0.9)] border border-[rgba(248,113,113,0.6)] text-[var(--ks-fg,#ffffff)] cursor-pointer hover:bg-[var(--ks-danger,#ef4444)] active:bg-[#b91c1c] shadow-lg"
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
                  const newFiles = Array.from(e.target.files).map(
                    createPendingFile
                  );
                  props.setPendingFiles([...props.pendingFiles, ...newFiles]);
                  e.target.value = "";
                }
              }}
            />

            <Show when={props.pendingFiles.length === 0}>
              <p class="text-[10px] text-[var(--ks-fg-subtle,#71717a)] mt-1">
                Drop files here or paste from clipboard.
              </p>
            </Show>
          </div>

          <Show when={!props.simpleMode}>
            <div class="flex justify-center pt-2">
              <button
                type="button"
                onClick={() =>
                  setViewMode(viewMode() === "default" ? "advanced" : "default")
                }
                class="text-xs text-[var(--ks-fg-subtle,#71717a)] hover:text-[var(--ks-accent,#fbbf24)] px-3 py-1.5 transition-colors cursor-pointer"
              >
                {viewMode() === "default"
                  ? "Show advanced fields"
                  : "Hide advanced fields"}
              </button>
            </div>

            <Show when={viewMode() === "advanced"}>
              <FormAdvancedSection
                amount={props.amount}
                category={props.category}
                taxType={props.taxType}
                setTaxType={props.setTaxType}
                hasEwt={props.hasEwt}
                setHasEwt={props.setHasEwt}
                ewtRate={props.ewtRate}
                setEwtRate={props.setEwtRate}
                isPrivate={props.isPrivate}
                setIsPrivate={props.setIsPrivate}
                sharedWith={props.sharedWith}
                setSharedWith={props.setSharedWith}
                sharedRoleCodes={props.sharedRoleCodes}
                setSharedRoleCodes={props.setSharedRoleCodes}
                orgMembers={props.orgMembers}
                shareableRoles={props.shareableRoles}
                canShare={props.canShare}
              />
            </Show>
          </Show>
        </div>

        <div class="px-5 sm:px-6 py-4 border-t border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] bg-[var(--ks-bg,#0a0a0a)] flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
          <div class="text-xs text-[var(--ks-fg-subtle,#71717a)]">
            <span class="text-[var(--ks-fg-subtle,#71717a)]">Will record as </span>
            <span
              class="font-bold"
              classList={{
                "text-[var(--ks-success-fg,#34d399)]": props.category === "sale",
                "text-[var(--ks-danger-fg,#f87171)]": props.category === "expense",
                "text-[var(--ks-accent,#fbbf24)]": props.category === "payable",
                "text-[var(--ks-info,#38bdf8)]": props.category === "business",
              }}
            >
              {(CATEGORY_FORM[props.category] || CATEGORY_FORM.expense).label}
            </span>
          </div>
          <div class="flex justify-end gap-3">
            <Show when={props.onCancel}>
              <Button
                intent="secondary"
                variant="ghost"
                onClick={props.onCancel}
                disabled={props.saving}
              >
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
