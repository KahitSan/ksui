// Source: KahitSan/kserp src/components/VoucherPicker.tsx (vendored into the plugin remote).
//
// Cross-plugin picker: fetches the SIBLING vouchers plugin's public API at
// /api/vouchers and degrades gracefully — when the vouchers plugin isn't
// deployed the popup shows a "couldn't load" notice and the sale records with
// no voucher (the manual-discount field stays available).

import { Portal } from "solid-js/web";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import Ticket from "lucide-solid/icons/ticket";
import X from "lucide-solid/icons/x";
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

interface VoucherPickerProps {
  selected: VoucherOption | null;
  onChange: (next: VoucherOption | null) => void;
  subtotal: number;
  packageIds: number[];
  disabled?: boolean;
  compact?: boolean;
}

const POPUP_MAX_HEIGHT = 360;
const POPUP_MIN_WIDTH = 320;

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

function isApplicable(
  voucher: VoucherOption,
  subtotal: number,
  packageIds: number[],
  todayIso: string,
): boolean {
  if (!voucher.is_active) return false;
  if (voucher.valid_from && todayIso < voucher.valid_from) return false;
  if (voucher.valid_until && todayIso > voucher.valid_until) return false;
  if (asNumber(voucher.minimum_purchase) > subtotal) return false;
  if (voucher.applicable_packages && voucher.applicable_packages.length > 0) {
    if (packageIds.length === 0) return false;
    const allowed = new Set(voucher.applicable_packages);
    if (!packageIds.every((id) => allowed.has(id))) return false;
  }
  return true;
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
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});

  let triggerRef: HTMLButtonElement | undefined;
  let popupRef: HTMLDivElement | undefined;
  let activeFetchToken = 0;

  createEffect(() => {
    if (!open()) return;
    const token = ++activeFetchToken;
    setLoading(true);
    setError(null);
    fetch("/api/vouchers?status=active&limit=200", { credentials: "include" })
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

  const applicable = createMemo(() => {
    const today_ = today();
    return vouchers().filter((v) => isApplicable(v, props.subtotal, props.packageIds, today_));
  });

  const inapplicable = createMemo(() => {
    const today_ = today();
    return vouchers().filter((v) => !isApplicable(v, props.subtotal, props.packageIds, today_));
  });

  const updatePosition = () => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const vpHeight = window.innerHeight;
    const vpWidth = window.innerWidth;
    const width = Math.max(POPUP_MIN_WIDTH, rect.width);
    const spaceBelow = vpHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp = spaceBelow < POPUP_MAX_HEIGHT && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      200,
      Math.min(POPUP_MAX_HEIGHT, flipUp ? spaceAbove - 12 : spaceBelow - 12),
    );
    const left = Math.min(Math.max(8, rect.left), vpWidth - width - 8);
    if (flipUp) {
      setPopupStyle({
        position: "fixed",
        bottom: `${vpHeight - rect.top + 4}px`,
        left: `${left}px`,
        width: `${width}px`,
        "max-height": `${maxHeight}px`,
      });
    } else {
      setPopupStyle({
        position: "fixed",
        top: `${rect.bottom + 4}px`,
        left: `${left}px`,
        width: `${width}px`,
        "max-height": `${maxHeight}px`,
      });
    }
  };

  createEffect(() => {
    if (!open()) return;
    updatePosition();

    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef?.contains(t)) return;
      if (popupRef?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onReflow = () => updatePosition();

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc, true);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc, true);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    });
  });

  const select = (v: VoucherOption | null) => {
    props.onChange(v);
    setOpen(false);
  };

  const clear = (e: MouseEvent) => {
    e.stopPropagation();
    props.onChange(null);
  };

  const previewDiscount = createMemo(() => calculateDiscount(props.selected, props.subtotal));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="voucher-picker-trigger"
        disabled={props.disabled}
        onClick={() => !props.disabled && setOpen((o) => !o)}
        class={`${props.compact ? "inline-flex" : "w-full flex"} items-center gap-2 ${
          props.compact ? "px-2.5 py-2" : "px-3 py-2.5"
        } rounded-lg bg-zinc-800/30 border border-zinc-700/50 hover:border-amber-500/40 hover:bg-amber-500/5 transition-colors text-sm text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
        aria-haspopup="listbox"
        aria-expanded={open()}
      >
        <Ticket size={16} class="shrink-0 text-zinc-400" />
        <Show when={props.selected} fallback={<span class="text-zinc-500 italic">No voucher</span>}>
          <span class="flex-1 min-w-0">
            <span class="block truncate text-zinc-100 font-medium">{props.selected!.code}</span>
            <span class="block truncate text-[11px] text-emerald-400">
              {formatVoucherDescription(props.selected!)}
              <Show when={previewDiscount() > 0}> · {formatCurrency(previewDiscount())} off</Show>
            </span>
          </span>
          <button
            type="button"
            data-testid="voucher-picker-clear"
            onClick={clear}
            class="shrink-0 p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            title="Remove voucher"
            aria-label="Remove voucher"
          >
            <X size={14} />
          </button>
        </Show>
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={popupRef}
            data-testid="voucher-picker-popup"
            class="z-[100] rounded-md border border-zinc-700 bg-zinc-900/95 backdrop-blur shadow-xl overflow-hidden flex flex-col"
            style={popupStyle()}
          >
            <div class="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
              <Ticket size={14} class="text-zinc-500 shrink-0" />
              <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">Vouchers</span>
              <Show when={loading()}>
                <Loader2 size={14} class="animate-spin text-zinc-500 ml-auto shrink-0" />
              </Show>
            </div>
            <ul
              role="listbox"
              aria-label="Available vouchers"
              class="m-0 p-0 list-none flex-1 overflow-y-auto"
            >
              <Show when={error()}>
                <li>
                  <div role="status" class="px-3 py-2 text-xs text-red-400">
                    {error()}
                  </div>
                </li>
              </Show>
              <Show
                when={!loading() && !error() && applicable().length === 0 && inapplicable().length === 0}
              >
                <li>
                  <div role="status" class="px-3 py-4 text-xs text-zinc-500 text-center">
                    No vouchers available.
                  </div>
                </li>
              </Show>
              <For each={applicable()}>
                {(v) => {
                  const discount = () => calculateDiscount(v, props.subtotal);
                  const selected = () => props.selected?.id === v.id;
                  return (
                    <li role="option" aria-selected={selected()}>
                      <button
                        type="button"
                        data-testid={`voucher-picker-result-${v.id}`}
                        onClick={() => select(v)}
                        class="w-full text-left px-3 py-2 hover:bg-amber-500/10 transition-colors flex items-start gap-2 cursor-pointer"
                      >
                        <Ticket size={14} class="shrink-0 mt-0.5 text-emerald-400" aria-hidden="true" />
                        <span class="flex-1 min-w-0">
                          <span class="block text-sm text-zinc-100 truncate">{v.code}</span>
                          <span class="block text-[11px] text-zinc-500 truncate">
                            {formatVoucherDescription(v)}
                          </span>
                        </span>
                        <span class="text-xs text-emerald-300 shrink-0 mt-0.5 font-mono">
                          {formatCurrency(discount())}
                        </span>
                        <Show when={selected()}>
                          <span class="text-amber-400 shrink-0 mt-0.5">✓</span>
                        </Show>
                      </button>
                    </li>
                  );
                }}
              </For>
              <Show when={inapplicable().length > 0}>
                <li>
                  <div class="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-600 font-semibold border-t border-zinc-800 mt-1">
                    Not applicable to this cart
                  </div>
                </li>
                <For each={inapplicable()}>
                  {(v) => (
                    <li>
                      <div
                        data-testid={`voucher-picker-inapplicable-${v.id}`}
                        class="w-full text-left px-3 py-2 flex items-start gap-2 opacity-50 cursor-not-allowed"
                        aria-disabled="true"
                      >
                        <Ticket size={14} class="shrink-0 mt-0.5 text-zinc-500" aria-hidden="true" />
                        <span class="flex-1 min-w-0">
                          <span class="block text-sm text-zinc-300 truncate">{v.code}</span>
                          <span class="block text-[11px] text-zinc-500 truncate">
                            {formatVoucherDescription(v)}
                          </span>
                        </span>
                      </div>
                    </li>
                  )}
                </For>
              </Show>
            </ul>
            <Show when={props.selected}>
              <div class="border-t border-zinc-800">
                <button
                  type="button"
                  data-testid="voucher-picker-clear-from-list"
                  onClick={() => select(null)}
                  class="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <X size={12} />
                  <span>Remove voucher</span>
                </button>
              </div>
            </Show>
          </div>
        </Portal>
      </Show>
    </>
  );
}
