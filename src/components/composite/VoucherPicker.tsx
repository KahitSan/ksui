// Vendored into plugin remotes.
//
// Cross-plugin picker: fetches vouchers over HTTP and degrades gracefully:
// when the endpoint isn't reachable the dialog shows a "couldn't load" notice
// and the sale records with no voucher (the manual-discount field stays
// available). Defaults to the vouchers plugin's own public API
// (/api/vouchers); `fetchUrl` overrides it for a consumer that reaches
// vouchers through a peer proxy route instead (same response shape required).

import { Modal } from "../base/Modal";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import Ticket from "lucide-solid/icons/ticket";
import X from "lucide-solid/icons/x";
import Search from "lucide-solid/icons/search";
import Loader2 from "lucide-solid/icons/loader-2";

export interface VoucherOption {
  id: number;
  code: string;
  type: "percentage" | "fixed_amount" | "free";
  value: string | number | null;
  max_discount_amount: string | number | null;
  applicable_packages: number[] | null;
  minimum_purchase: string | number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
}

const DEFAULT_FETCH_URL = "/api/vouchers?status=active&limit=200";

interface VoucherPickerProps {
  selected: VoucherOption | null;
  onChange: (next: VoucherOption | null) => void;
  subtotal: number;
  packageIds: number[];
  disabled?: boolean;
  compact?: boolean;
  /** Same-shape endpoint override (defaults to the vouchers plugin's own API) —
   *  a consumer with no `vouchers.view` grant can point this at a peer proxy
   *  route instead. */
  fetchUrl?: string;
  /** Cheapest/priciest total still reachable from what the cart offers. Used to
   *  preview a discount RANGE while `subtotal` is still 0, instead of a
   *  meaningless zero. */
  subtotalRange?: { min: number; max: number };
}

function asNumber(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "string" ? parseFloat(v) : v;
}

export function calculateDiscount(voucher: VoucherOption | null, subtotal: number): number {
  if (!voucher || subtotal <= 0) return 0;
  if (voucher.type === "free") return subtotal;
  if (voucher.type === "fixed_amount") {
    return Math.min(asNumber(voucher.value), subtotal);
  }
  if (voucher.type === "percentage") {
    const raw = Math.round((subtotal * asNumber(voucher.value)) / 100);
    const cap = voucher.max_discount_amount != null ? asNumber(voucher.max_discount_amount) : raw;
    return Math.min(raw, cap);
  }
  return 0;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
}

/** Null when the voucher can be applied; otherwise the shopper-facing reason it can't. */
function ineligibilityReason(
  voucher: VoucherOption,
  subtotal: number,
  packageIds: number[],
  todayIso: string,
): string | null {
  if (!voucher.is_active) return "Inactive";
  if (voucher.valid_from && todayIso < voucher.valid_from)
    return `Starts ${voucher.valid_from}`;
  if (voucher.valid_until && todayIso > voucher.valid_until)
    return `Expired ${voucher.valid_until}`;
  if (asNumber(voucher.minimum_purchase) > subtotal)
    return `Needs ${formatCurrency(asNumber(voucher.minimum_purchase))} minimum`;
  if (voucher.applicable_packages && voucher.applicable_packages.length > 0) {
    if (packageIds.length === 0) return "Only for specific items";
    const allowed = new Set(voucher.applicable_packages);
    if (!packageIds.every((id) => allowed.has(id))) return "Doesn't cover every item";
  }
  return null;
}

// Single source of truth with the reason list above, so the two can't drift.
function isApplicable(
  voucher: VoucherOption,
  subtotal: number,
  packageIds: number[],
  todayIso: string,
): boolean {
  return ineligibilityReason(voucher, subtotal, packageIds, todayIso) === null;
}

function formatVoucherDescription(v: VoucherOption): string {
  if (v.type === "free") return "Free of charge";
  if (v.type === "fixed_amount") return `${formatCurrency(asNumber(v.value))} off`;
  if (v.type === "percentage") {
    const cap = v.max_discount_amount != null ? asNumber(v.max_discount_amount) : 0;
    return cap > 0
      ? `${asNumber(v.value)}% off (up to ${formatCurrency(cap)})`
      : `${asNumber(v.value)}% off`;
  }
  return "";
}
export default function VoucherPicker(props: VoucherPickerProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [vouchers, setVouchers] = createSignal<VoucherOption[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");

  let activeFetchToken = 0;

  createEffect(() => {
    if (!open()) return;
    const token = ++activeFetchToken;
    setLoading(true);
    setError(null);
    fetch(props.fetchUrl ?? DEFAULT_FETCH_URL, { credentials: "include" })
      .then((r) => {
        if (!r.ok)
          throw new Error(
            r.status === 403
              ? "Permission denied"
              : r.status === 404
                ? "Vouchers module isn't available"
                : "Failed to load",
          );
        return r.json();
      })
      .then((json) => {
        if (token !== activeFetchToken) return;
        setVouchers((json.data || []) as VoucherOption[]);
      })
      .catch((e) => {
        if (token !== activeFetchToken) return;
        setError(e instanceof Error ? e.message : "Failed to load");
        setVouchers([]);
      })
      .finally(() => {
        if (token !== activeFetchToken) return;
        setLoading(false);
      });
  });

  const today = () => new Date().toISOString().slice(0, 10);

  const matchesQuery = (v: VoucherOption) => {
    const q = query().trim().toLowerCase();
    return q === "" || v.code.toLowerCase().includes(q);
  };

  const applicable = createMemo(() => {
    const today_ = today();
    return vouchers().filter(
      (v) => matchesQuery(v) && isApplicable(v, props.subtotal, props.packageIds, today_),
    );
  });

  const inapplicable = createMemo(() => {
    const today_ = today();
    return vouchers()
      .filter((v) => matchesQuery(v) && !isApplicable(v, props.subtotal, props.packageIds, today_))
      .map((v) => ({
        voucher: v,
        reason: ineligibilityReason(v, props.subtotal, props.packageIds, today_) ?? "",
      }));
  });

  const openPicker = () => {
    if (props.disabled) return;
    setQuery("");
    setOpen(true);
  };

  const close = () => setOpen(false);

  const select = (v: VoucherOption | null) => {
    props.onChange(v);
    close();
  };

  const clear = (e: MouseEvent) => {
    e.stopPropagation();
    props.onChange(null);
  };

  const previewDiscount = createMemo(() => calculateDiscount(props.selected, props.subtotal));

  // Nothing priced yet: preview against the cheapest/priciest total the cart
  // could still reach, so the row shows a real range instead of a bare zero.
  const rangePreview = createMemo(() => {
    const r = props.subtotalRange;
    if (props.subtotal > 0 || !r || r.max <= 0) return null;
    return r;
  });

  const discountLabel = (v: VoucherOption): string => {
    const r = rangePreview();
    if (!r) return `−${formatCurrency(calculateDiscount(v, props.subtotal))}`;
    const lo = calculateDiscount(v, r.min);
    const hi = calculateDiscount(v, r.max);
    return lo === hi ? `−${formatCurrency(hi)}` : `−${formatCurrency(lo)}–${formatCurrency(hi)}`;
  };

  // An ancestor may close itself on a document-level Escape; the dialog handles
  // its own dismissal, so keep the key from reaching that listener.
  const swallowEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") e.stopPropagation();
  };

  createEffect(() => {
    if (!open()) return;
    document.addEventListener("keydown", swallowEscape, true);
    onCleanup(() => document.removeEventListener("keydown", swallowEscape, true));
  });

  return (
    <>
      <button
        type="button"
        data-testid="voucher-picker-trigger"
        disabled={props.disabled}
        onClick={openPicker}
        class={`${props.compact ? "inline-flex" : "w-full flex"} items-center gap-2 ${
          props.compact ? "px-2.5 py-2" : "px-3 py-2.5"
        } rounded-lg bg-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_30%,transparent)] border border-[color-mix(in_srgb,var(--ks-border-strong,#3f3f46)_50%,transparent)] hover:border-[color-mix(in_srgb,var(--ks-primary,#c9a961)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--ks-primary,#c9a961)_5%,transparent)] transition-colors text-sm text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
        aria-haspopup="dialog"
        aria-expanded={open()}
      >
        <Ticket size={16} class="shrink-0 text-[var(--ks-fg-muted,#a1a1aa)]" />
        <Show when={props.selected} fallback={<span class="text-[var(--ks-fg-subtle,#71717a)] italic">No voucher</span>}>
          <span class="flex-1 min-w-0">
            <span class="block truncate text-[var(--ks-fg,#ffffff)] font-medium">{props.selected!.code}</span>
            <span class="block truncate text-[11px] text-[var(--ks-success-fg,#34d399)]">
              {formatVoucherDescription(props.selected!)}
              <Show when={previewDiscount() > 0}> · {formatCurrency(previewDiscount())} off</Show>
            </span>
          </span>
          <button
            type="button"
            data-testid="voucher-picker-clear"
            onClick={clear}
            class="shrink-0 p-1 rounded text-[var(--ks-fg-subtle,#71717a)] hover:text-[var(--ks-danger-fg,#f87171)] hover:bg-[color-mix(in_srgb,var(--ks-danger,#ef4444)_10%,transparent)] transition-colors cursor-pointer"
            title="Remove voucher"
            aria-label="Remove voucher"
          >
            <X size={14} />
          </button>
        </Show>
      </button>

      <Show when={open()}>
        <Modal onClose={close} size="xl" ariaLabel="Select a voucher">
          <div data-testid="voucher-picker-popup" class="flex flex-col max-h-[70vh]">
            {/* Bled to the card edges (the card owns the padding) so the rule
                under the title spans the full width. */}
            <div class="-mx-6 -mt-6 px-5 sm:px-6 py-3 border-b border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] flex items-center justify-between gap-3 shrink-0">
              <div class="flex items-center gap-2 min-w-0">
                <Ticket size={16} class="text-[var(--ks-fg-muted,#a1a1aa)] shrink-0" aria-hidden="true" />
                <h2 class="m-0 text-base font-semibold text-[var(--ks-fg,#ffffff)] truncate">
                  Select a voucher
                </h2>
                <Show when={loading()}>
                  <Loader2 size={14} class="animate-spin text-[var(--ks-fg-subtle,#71717a)] shrink-0" />
                </Show>
              </div>
              <button
                type="button"
                data-testid="voucher-picker-close"
                onClick={close}
                class="w-8 h-8 flex items-center justify-center rounded text-[var(--ks-fg-muted,#a1a1aa)] hover:text-[var(--ks-fg,#ffffff)] hover:bg-[color-mix(in_srgb,var(--ks-surface-raised,#1a1a1a)_50%,transparent)] transition-colors cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div class="mt-4 shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-[color-mix(in_srgb,var(--ks-border-strong,#3f3f46)_60%,transparent)] bg-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_25%,transparent)] focus-within:border-[color-mix(in_srgb,var(--ks-primary,#c9a961)_50%,transparent)] transition-colors">
              <Search size={16} class="shrink-0 text-[var(--ks-fg-subtle,#71717a)]" aria-hidden="true" />
              <input
                type="text"
                data-testid="voucher-picker-search"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                placeholder="Search voucher code…"
                aria-label="Search voucher code"
                class="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm text-[var(--ks-fg,#ffffff)] placeholder:text-[var(--ks-fg-subtle,#71717a)]"
              />
              <Show when={query() !== ""}>
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  class="shrink-0 p-0.5 rounded text-[var(--ks-fg-subtle,#71717a)] hover:text-[var(--ks-fg,#ffffff)] transition-colors cursor-pointer"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              </Show>
            </div>

            <ul
              role="listbox"
              aria-label="Available vouchers"
              class="m-0 mt-3 p-0 list-none flex-1 overflow-y-auto -mx-1 px-1"
            >
              <Show when={error()}>
                <li>
                  <div role="status" class="px-3 py-3 text-sm text-[var(--ks-danger-fg,#f87171)]">
                    {error()}
                  </div>
                </li>
              </Show>
              <Show
                when={!loading() && !error() && applicable().length === 0 && inapplicable().length === 0}
              >
                <li>
                  <div role="status" class="px-3 py-8 text-sm text-[var(--ks-fg-subtle,#71717a)] text-center">
                    <Show when={query().trim() !== ""} fallback="No vouchers available.">
                      No voucher matches “{query()}”.
                    </Show>
                  </div>
                </li>
              </Show>
              <For each={applicable()}>
                {(v) => {
                  const selected = () => props.selected?.id === v.id;
                  return (
                    <li role="option" aria-selected={selected()}>
                      <button
                        type="button"
                        data-testid={`voucher-picker-result-${v.id}`}
                        onClick={() => select(v)}
                        class="w-full text-left px-3 py-3 mb-1 rounded-lg border transition-colors flex items-center gap-3 cursor-pointer border-[color-mix(in_srgb,var(--ks-border-strong,#3f3f46)_40%,transparent)] hover:border-[color-mix(in_srgb,var(--ks-primary,#c9a961)_50%,transparent)] hover:bg-[color-mix(in_srgb,var(--ks-primary,#c9a961)_8%,transparent)]"
                        classList={{
                          "border-[color-mix(in_srgb,var(--ks-primary,#c9a961)_60%,transparent)] bg-[color-mix(in_srgb,var(--ks-primary,#c9a961)_12%,transparent)]":
                            selected(),
                        }}
                      >
                        <Ticket size={18} class="shrink-0 text-[var(--ks-success-fg,#34d399)]" aria-hidden="true" />
                        <span class="flex-1 min-w-0">
                          <span class="block text-sm font-medium text-[var(--ks-fg,#ffffff)] truncate">{v.code}</span>
                          <span class="block text-xs text-[var(--ks-fg-subtle,#71717a)] truncate">
                            {formatVoucherDescription(v)}
                          </span>
                        </span>
                        <span class="text-sm text-[var(--ks-success-fg,#34d399)] shrink-0 font-mono">
                          {discountLabel(v)}
                        </span>
                        <Show when={selected()}>
                          <span class="text-[var(--ks-accent,#fbbf24)] shrink-0" aria-hidden="true">✓</span>
                        </Show>
                      </button>
                    </li>
                  );
                }}
              </For>
              <Show when={inapplicable().length > 0}>
                <li>
                  <div class="px-1 pt-3 pb-2 text-[11px] uppercase tracking-widest text-[var(--ks-fg-subtle,#71717a)] font-semibold border-t border-[var(--ks-border-strong,#3f3f46)] mt-2">
                    Not applicable to this cart
                  </div>
                </li>
                <For each={inapplicable()}>
                  {(entry) => (
                    <li>
                      <div
                        data-testid={`voucher-picker-inapplicable-${entry.voucher.id}`}
                        class="w-full text-left px-3 py-3 mb-1 rounded-lg border border-transparent flex items-center gap-3 opacity-60 cursor-not-allowed"
                        aria-disabled="true"
                      >
                        <Ticket size={18} class="shrink-0 text-[var(--ks-fg-subtle,#71717a)]" aria-hidden="true" />
                        <span class="flex-1 min-w-0">
                          <span class="block text-sm text-[var(--ks-fg,#ffffff)] truncate">{entry.voucher.code}</span>
                          <span class="block text-xs text-[var(--ks-fg-subtle,#71717a)] truncate">
                            {formatVoucherDescription(entry.voucher)}
                          </span>
                        </span>
                        <span class="text-xs text-[var(--ks-warning-fg,#fbbf24)] shrink-0 text-right max-w-[45%] truncate">
                          {entry.reason}
                        </span>
                      </div>
                    </li>
                  )}
                </For>
              </Show>
            </ul>

            <Show when={props.selected}>
              <div class="shrink-0 mt-3 pt-3 border-t border-[var(--ks-border-strong,#3f3f46)]">
                <button
                  type="button"
                  data-testid="voucher-picker-clear-from-list"
                  onClick={() => select(null)}
                  class="w-full px-3 py-2.5 rounded-lg text-sm text-[var(--ks-danger-fg,#f87171)] hover:bg-[color-mix(in_srgb,var(--ks-danger,#ef4444)_10%,transparent)] transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <X size={14} />
                  <span>Remove voucher</span>
                </button>
              </div>
            </Show>
          </div>
        </Modal>
      </Show>
    </>
  );
}
