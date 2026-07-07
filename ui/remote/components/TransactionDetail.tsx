// Detail-pane sub-components for the transactions /_ui screen.
// Extracted verbatim from index.tsx — entirely props-driven, no closure
// dependency on Component(). useAccountsIndex() is the host-runtime context,
// preserved by reading it from the same @kahitsan/ksui re-export.

import { createSignal, Show, For } from "solid-js";
import Plus from "lucide-solid/icons/plus";
import Loader2 from "lucide-solid/icons/loader-2";
import Lock from "lucide-solid/icons/lock";
import Paperclip from "lucide-solid/icons/paperclip";
import Trash2 from "lucide-solid/icons/trash-2";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import CalendarDays from "lucide-solid/icons/calendar-days";

import { formatCurrency, formatDate, formatDateTime } from "../lib/format";
import type { PendingFile } from "@kahitsan/ksui";
import { type Transaction } from "../lib/types";
import {
  CATEGORY_TONE,
  TONE_CLASSES,
  PAYABLE_KIND_OPTIONS,
  PDC_OPTIONS,
  TAX_TYPE_LABELS,
} from "../lib/constants";

import {
  Avatar,
  AddAttachmentTile,
  DetailRow,
  AccountAvatar,
  useAccountsIndex,
  resolveAccount,
  MarkdownNotes,
  ExistingAttachmentTile,
} from "@kahitsan/ksui";

export function TransactionDetailSkeleton() {
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

export function TransactionDetail(props: {
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
        <div
          class={`text-4xl sm:text-5xl font-bold tabular-nums leading-none ${c.text}`}
        >
          {tone.sign}
          {formatCurrency(t.amount)}
        </div>
        <Show
          when={
            t.tax_type !== "vat_exempt" &&
            t.tax_type !== "non_vat" &&
            parseFloat(t.tax_amount) > 0
          }
        >
          <div class="mt-2 text-[11px] text-zinc-500 tabular-nums">
            Subtotal {formatCurrency(t.subtotal || "0")}
            {" · "}
            VAT ({t.tax_type === "vat_inclusive" ? "incl." : "excl."}{" "}
            {t.tax_rate}%) {formatCurrency(t.tax_amount)}
          </div>
        </Show>
        <Show when={t.tax_type === "vat_exempt"}>
          <div class="mt-2 text-[10px] uppercase tracking-widest text-zinc-600">
            VAT Exempt
          </div>
        </Show>
        <Show when={t.tax_type === "non_vat"}>
          <div class="mt-2 text-[10px] uppercase tracking-widest text-zinc-600">
            Non-VAT
          </div>
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
              t.category === "sale"
                ? "Received from"
                : t.category === "payable"
                ? "Payable to"
                : "Paid to"
            }
            value={t.payee}
          />
        </Show>
        <Show
          when={t.category === "business"}
          fallback={
            <AccountDetailRow
              label={
                t.category === "sale"
                  ? "Received in"
                  : t.category === "payable"
                  ? "Funding account"
                  : "Paid from"
              }
              value={
                t.category === "sale"
                  ? t.destination_account_name
                  : t.source_account_name
              }
              accountId={
                t.category === "sale"
                  ? t.destination_account_id
                  : t.source_account_id
              }
            />
          }
        >
          <AccountDetailRow
            label="From account"
            value={t.source_account_name}
            accountId={t.source_account_id}
          />
          <AccountDetailRow
            label="To account"
            value={t.destination_account_name}
            accountId={t.destination_account_id}
          />
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
                      <Show
                        when={
                          li.client_name && li.client_name !== t.client_name
                        }
                      >
                        <span> · for {li.client_name}</span>
                      </Show>
                    </div>
                  </div>
                  <div class="text-zinc-300 tabular-nums whitespace-nowrap">
                    {formatCurrency(
                      (li.quantity * parseFloat(li.unit_price)).toFixed(2)
                    )}
                  </div>
                </div>
              )}
            </For>
          </div>
          <Show
            when={
              t.voucher ||
              (t.discount_amount && parseFloat(t.discount_amount) > 0)
            }
          >
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
              <Show when={t.payment_status === "forfeited"}>
                <span class="rounded-full border border-zinc-600/60 bg-zinc-800/60 px-2 py-0.5 text-[10px] text-zinc-300 normal-case tracking-normal">
                  Forfeited
                </span>
              </Show>
            </div>
            <Show
              when={
                t.payment_status === "partial" || t.payment_status === "unpaid"
              }
            >
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
                      <Show
                        when={
                          props.canEdit &&
                          t.status !== "voided" &&
                          props.onDeletePayment
                        }
                      >
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
                      <Show
                        when={resolveAccount(
                          accountsIndex(),
                          p.financial_account_id
                        )}
                      >
                        {(a) => <AccountAvatar account={a()} size={16} />}
                      </Show>
                      <span class="text-[11px] text-zinc-300 truncate flex-1">
                        {p.financial_account_name ??
                          `Account #${p.financial_account_id}`}
                      </span>
                      <span class="text-[11px] font-semibold tabular-nums text-zinc-100 shrink-0">
                        {formatCurrency(p.amount)}
                      </span>
                    </div>
                    <Show when={p.notes}>
                      <div class="mt-1 text-[10px] text-zinc-500 truncate">
                        {p.notes}
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show
            when={
              (t.payment_status === "partial" ||
                t.payment_status === "unpaid") &&
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
                  ? PAYABLE_KIND_OPTIONS.find((p) => p.id === t.payable_kind)
                      ?.label || t.payable_kind
                  : null
              }
            />
            <DetailRow
              label="Due date"
              value={t.due_date ? formatDate(t.due_date) : null}
            />
            <Show when={t.cheque_number}>
              <DetailRow label="Cheque #" value={t.cheque_number} />
              <DetailRow
                label="PDC status"
                value={
                  t.pdc_status
                    ? PDC_OPTIONS.find((p) => p.id === t.pdc_status)?.label ||
                      t.pdc_status
                    : null
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
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">
            Notes
          </p>
          <MarkdownNotes
            value={t.notes}
            class="text-sm text-zinc-300 leading-relaxed"
          />
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
            <span>
              {showAdvanced()
                ? "Hide advanced details"
                : "Show advanced details"}
            </span>
            <Show
              when={showAdvanced()}
              fallback={<ChevronDown class="text-zinc-600" size={14} />}
            >
              <ChevronUp class="text-zinc-600" size={14} />
            </Show>
          </button>
          <Show when={showAdvanced()}>
            <div
              data-testid="detail-advanced-section"
              class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3"
            >
              <Show when={t.tax_type}>
                <DetailRow
                  label="Tax type"
                  value={TAX_TYPE_LABELS[t.tax_type] || t.tax_type}
                />
              </Show>
              <Show
                when={
                  (t.tax_type === "vat_inclusive" ||
                    t.tax_type === "vat_exclusive") &&
                  t.tax_amount !== null &&
                  t.tax_amount !== undefined &&
                  parseFloat(t.tax_amount) > 0
                }
              >
                <DetailRow
                  label={`VAT (${t.tax_rate}%)`}
                  value={formatCurrency(t.tax_amount)}
                />
                <Show when={t.subtotal !== null && t.subtotal !== undefined}>
                  <DetailRow
                    label="VAT base"
                    value={formatCurrency(t.subtotal || "0")}
                  />
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
            <Avatar
              name={props.creatorName || t.created_by_name || "Unknown"}
              image={t.created_by_image}
              size="md"
            />
            <div class="min-w-0">
              <span class="text-sm text-zinc-200 block truncate">
                {props.creatorName || t.created_by_name || "Unknown"}
              </span>
              <span class="text-[11px] text-zinc-500 block">
                {new Date(t.created_at).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
        <Show
          when={t.updated_by && t.updated_at && t.updated_at !== t.created_at}
        >
          <div>
            <span class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold block mb-1.5">
              Last updated by
            </span>
            <div class="flex items-center gap-2">
              <Avatar
                name={t.updated_by_name || "Unknown"}
                image={t.updated_by_image}
                size="md"
              />
              <div class="min-w-0">
                <span class="text-sm text-zinc-200 block truncate">
                  {t.updated_by_name || "Unknown"}
                </span>
                <span class="text-[11px] text-zinc-500 block">
                  {new Date(t.updated_at).toLocaleString()}
                </span>
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
            fallback={
              <span class="text-xs text-zinc-500 mt-1 block">
                Only visible to creator
              </span>
            }
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
          <Show
            when={props.txn.attachments && props.txn.attachments.length > 0}
          >
            <span class="text-zinc-600">({props.txn.attachments!.length})</span>
          </Show>
        </div>

        <div class="flex gap-2 overflow-x-auto pt-3 pr-3 pb-2 items-start">
          <For each={props.txn.attachments}>
            {(att) => (
              <ExistingAttachmentTile
                attachment={att}
                testId={`txn-attachment-${att.id}`}
                rawHref={`/api/transactions/${t.id}/attachments/${att.id}/raw`}
                onDelete={
                  props.canEdit
                    ? (attId) => props.onDeleteAttachment(t.id, attId)
                    : undefined
                }
              />
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

/** Thin wrapper around ksui.DetailRow that adds optional account avatar resolution. */
function AccountDetailRow(props: {
  label: string;
  value: string | null | undefined;
  accountId?: number | null;
}) {
  const accountsIndex = useAccountsIndex();
  const acct = () =>
    props.accountId != null
      ? resolveAccount(accountsIndex(), props.accountId)
      : null;
  return (
    <div>
      <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">
        {props.label}
      </div>
      <div class="text-sm text-zinc-100 font-medium leading-snug break-words flex items-center gap-2">
        <Show when={acct()}>
          {(a) => <AccountAvatar account={a()} size={18} />}
        </Show>
        <span class="min-w-0 break-words">{props.value || "—"}</span>
      </div>
    </div>
  );
}
