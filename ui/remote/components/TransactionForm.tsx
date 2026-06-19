// The transaction create/edit form: category type picker, SalesBodyEditor mount,
// amount/date/backdate/description, PayeePicker + ref number, subcategory
// createResource + SearchableSelect, payable-details pane, AccountPicker wiring,
// notes, attachments drag/drop/paste/camera + pending-file tiles, footer. The
// advanced fields live in FormAdvancedSection, gated here by the
// `viewMode === "advanced"` <Show>. Carved verbatim out of index.tsx; the two
// call sites there keep their explicit prop lists unchanged.

import { createEffect, createResource, createSignal, Show, For } from "solid-js";
import X from "lucide-solid/icons/x";
import Upload from "lucide-solid/icons/upload";
import FileIcon from "lucide-solid/icons/file";
import CalendarDays from "lucide-solid/icons/calendar-days";
import Paperclip from "lucide-solid/icons/paperclip";
import AccountPicker from "./AccountPicker";
import FormAdvancedSection from "./FormAdvancedSection";
import SalesBodyEditor, { type SalesLine } from "./SalesBodyEditor";
import Store from "lucide-solid/icons/store";

// Payee data-wiring for the generic ComboBox engine. Search/create hit the
// sibling payees plugin's /api/payees endpoint directly; `kind` is "customer"
// for sales and "vendor" otherwise. Degrades gracefully — a missing payees
// plugin surfaces a notice and the free-text fallback (selectedName) still works.
async function searchPayees(query: string, kind: PayeeKind): Promise<PayeeOption[]> {
  const params = new URLSearchParams({ status: "active", limit: "20", kind });
  if (query) params.set("search", query);
  const r = await fetch(`/api/payees?${params.toString()}`, { credentials: "include" });
  if (!r.ok) {
    if (r.status === 403) throw new Error("Permission denied");
    if (r.status === 404) throw new Error("Payees module isn't available — type a name instead");
    throw new Error("Failed to load");
  }
  const json = (await r.json()) as { data?: PayeeOption[] };
  return json.data ?? [];
}

async function createPayee(name: string, kind: PayeeKind): Promise<PayeeOption> {
  const res = await fetch("/api/payees", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, kind }),
  });
  if (!res.ok && res.status !== 200) {
    const body = (await res.json().catch(() => ({ error: "Failed to create payee" }))) as {
      error?: string;
    };
    throw new Error(body.error || "Failed to create payee");
  }
  return (await res.json()) as PayeeOption;
}

function payeeSecondary(p: PayeeOption): string | null {
  if (!p.default_subcategory && p.kind === "vendor") return null;
  return [p.kind === "vendor" ? null : p.kind, p.default_subcategory].filter(Boolean).join(" · ") || null;
}

import {
  type PendingFile,
  createPendingFile,
  revokePendingFile,
  type Attachment,
  type FinancialAccount,
  type OrgMember,
  type ShareableRole,
} from "../lib/types";
import {
  CATEGORY_FORM,
  CATEGORY_TONE,
  TONE_CLASSES,
  PAYABLE_KIND_OPTIONS,
  PDC_OPTIONS,
} from "../lib/constants";

import { SearchableSelect } from "@kserp/host-ui";
import {
  MentionTextarea,
  CameraCapture,
  AddAttachmentTile,
  ExistingAttachmentTile,
  FormField,
  type ClientOption,
  type VoucherOption,
  ComboBox,
  SegmentedFilter,
  type PayeeOption,
  type PayeeKind,
  DatePicker,
  Button,
} from "@kahitsan/ksui";

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

export default function TransactionForm(props: TransactionFormProps) {
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
                <ComboBox<PayeeOption>
                  testIdPrefix="form-payee-picker"
                  selected={selectedPayee()}
                  selectedName={props.payee}
                  search={(q) => searchPayees(q, props.category === "sale" ? "customer" : "vendor")}
                  onCreate={(name) => createPayee(name, props.category === "sale" ? "customer" : "vendor")}
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
