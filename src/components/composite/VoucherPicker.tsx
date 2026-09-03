// Vendored into plugin remotes.
//
// Cross-plugin picker: fetches vouchers over HTTP and degrades gracefully:
// when the endpoint isn't reachable the dialog shows a "couldn't load" notice
// and the sale records with no voucher (the manual-discount field stays
// available). Defaults to the vouchers plugin's own public API
// (/api/vouchers); `fetchUrl` overrides it for a consumer that reaches
// vouchers through a peer proxy route instead (same response shape required).

import { Modal } from "../base/Modal";
import { highlightMatch } from "../../utils/highlight";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import Ticket from "lucide-solid/icons/ticket";
import X from "lucide-solid/icons/x";
import Search from "lucide-solid/icons/search";
import Loader2 from "lucide-solid/icons/loader-2";
import CalendarClock from "lucide-solid/icons/calendar-clock";

export interface VoucherOption {
  id: number;
  code: string;
  type: "percentage" | "fixed_amount" | "free";
  value: string | number | null;
  max_discount_amount: string | number | null;
  applicable_packages: number[] | null;
  applicable_package_lineages?: string[] | null;
  minimum_purchase: string | number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  /** Redemptions so far. Absent on endpoints that don't expose usage. */
  usage_count?: number | null;
  /** Total redemptions allowed; null/absent means unlimited. */
  usage_limit_total?: number | null;
  /** Free-text description; absent on endpoints that don't expose it. */
  notes?: string | null;
}

const DEFAULT_FETCH_URL = "/api/vouchers?status=active&limit=200";

interface VoucherPickerProps {
  selected: VoucherOption | null;
  onChange: (next: VoucherOption | null) => void;
  subtotal: number;
  packageIds: number[];
  packageLineages?: (string | null)[];
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

/** True once every allowed redemption is spent. Unlimited codes never exhaust. */
function usageExhausted(v: VoucherOption): boolean {
  const limit = v.usage_limit_total;
  if (limit == null || limit <= 0) return false;
  return (v.usage_count ?? 0) >= limit;
}

/** "3/10 used" — null when the endpoint omits usage or the code is unlimited. */
function formatUsage(v: VoucherOption): string | null {
  const limit = v.usage_limit_total;
  if (limit == null || limit <= 0) return null;
  return `${v.usage_count ?? 0}/${limit} used`;
}

/** Few enough redemptions left that the cashier should notice. */
function nearlyUsedUp(v: VoucherOption): boolean {
  const limit = v.usage_limit_total;
  if (limit == null || limit <= 0) return false;
  const left = limit - (v.usage_count ?? 0);
  return left > 0 && left <= Math.max(1, Math.ceil(limit * 0.2));
}

/** Null when the voucher can be applied; otherwise the shopper-facing reason it can't. */
function ineligibilityReason(
  voucher: VoucherOption,
  subtotal: number,
  packageIds: number[],
  packageLineages: (string | null)[],
  todayIso: string,
): string | null {
  if (!voucher.is_active) return "Inactive";
  if (voucher.valid_from && todayIso < toDay(voucher.valid_from))
    return `Starts ${toDay(voucher.valid_from)}`;
  if (voucher.valid_until && todayIso > toDay(voucher.valid_until))
    return `Expired ${toDay(voucher.valid_until)}`;
  // Mirrors the server's usage gate — without it an exhausted code looks
  // selectable here and is only rejected at charge time.
  if (usageExhausted(voucher)) return "Fully redeemed";
  if (asNumber(voucher.minimum_purchase) > subtotal)
    return `Needs ${formatCurrency(asNumber(voucher.minimum_purchase))} minimum`;
  const allowedIds = voucher.applicable_packages ?? [];
  const allowedLineages = voucher.applicable_package_lineages ?? [];
  if (allowedIds.length > 0 || allowedLineages.length > 0) {
    if (packageIds.length === 0) return "Only for specific items";
    const allowed = new Set(allowedIds);
    if (packageIds.some((id, index) =>
      !allowed.has(id) &&
      !(packageLineages[index] != null && allowedLineages.includes(packageLineages[index]!))
    )) {
      return "Doesn't cover every item";
    }
  }
  return null;
}

// Single source of truth with the reason list above, so the two can't drift.
function isApplicable(
  voucher: VoucherOption,
  subtotal: number,
  packageIds: number[],
  packageLineages: (string | null)[],
  todayIso: string,
): boolean {
  return ineligibilityReason(voucher, subtotal, packageIds, packageLineages, todayIso) === null;
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

/** A date column may serialize as a bare date or a full timestamp; keep the day. */
function toDay(value: string): string {
  return value.slice(0, 10);
}

/** Whole days from today to `day`; negative once it's in the past. */
function daysUntil(day: string, todayIso: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86400000);
}

/** Short human expiry for the row's meta line. Null when the voucher never expires. */
function formatExpiry(validUntil: string | null, todayIso: string): string | null {
  if (!validUntil) return null;
  const day = toDay(validUntil);
  if (day < todayIso) return `Expired ${day}`;
  const days = daysUntil(day, todayIso);
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  if (days <= 30) return `Expires in ${days} days`;
  return `Expires ${day}`;
}

// Server page size. The list is paged in on scroll so an account with hundreds
// of codes doesn't ship (or mount) all of them just to open the picker.
const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 200;

export default function VoucherPicker(props: VoucherPickerProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [vouchers, setVouchers] = createSignal<VoucherOption[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [page, setPage] = createSignal(1);
  const [total, setTotal] = createSignal(0);
  // Staged choice. `props.selected` only changes on Confirm.
  const [draft, setDraft] = createSignal<VoucherOption | null>(null);
  // Footer description popup: clamped to two lines, "More" only when it overflows.
  const [descOpen, setDescOpen] = createSignal(false);
  const [descOverflowing, setDescOverflowing] = createSignal(false);
  let descEl: HTMLSpanElement | undefined;

  // Signal, not a plain ref: the sentinel mounts only once the first page
  // reveals there are more, which is after the observer effect first runs.
  const [sentinel, setSentinel] = createSignal<HTMLDivElement | undefined>();

  let activeFetchToken = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const baseUrl = () => props.fetchUrl ?? DEFAULT_FETCH_URL;

  // The endpoint may already carry query params; append rather than assume "?".
  const pageUrl = (p: number, search: string): string => {
    const [path, existing] = baseUrl().split("?");
    const qs = new URLSearchParams(existing ?? "");
    qs.set("page", String(p));
    qs.set("limit", String(PAGE_SIZE));
    if (search) qs.set("search", search);
    else qs.delete("search");
    return `${path}?${qs.toString()}`;
  };

  const loadPage = (p: number, search: string, append: boolean) => {
    const token = ++activeFetchToken;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    fetch(pageUrl(p, search), { credentials: "include" })
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
        const rows = (json.data || []) as VoucherOption[];
        setTotal(typeof json.total === "number" ? json.total : rows.length);
        setPage(p);
        setVouchers((prev) => (append ? [...prev, ...rows] : rows));
      })
      .catch((e) => {
        if (token !== activeFetchToken) return;
        setError(e instanceof Error ? e.message : "Failed to load");
        if (!append) setVouchers([]);
      })
      .finally(() => {
        if (token !== activeFetchToken) return;
        setLoading(false);
        setLoadingMore(false);
      });
  };

  // Debounce the keystrokes into a server-side search, so filtering spans the
  // whole table rather than only the pages already pulled down.
  createEffect(() => {
    const q = query();
    if (!open()) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => setDebouncedQuery(q.trim()), SEARCH_DEBOUNCE_MS);
  });
  onCleanup(() => clearTimeout(debounceTimer));

  // Refetch from page 1 whenever the dialog opens or the search term settles.
  createEffect(() => {
    if (!open()) return;
    const search = debouncedQuery();
    loadPage(1, search, false);
  });

  const hasMore = createMemo(() => vouchers().length < total());

  const loadNext = () => {
    if (loading() || loadingMore() || !hasMore()) return;
    loadPage(page() + 1, debouncedQuery(), true);
  };

  // Scroll sentinel: pull the next page when the end of the list comes into view.
  // Re-created after every append — an observer only reports a CHANGE in
  // intersection, so a sentinel that stays on screen (list still shorter than
  // the viewport) would never fire again and paging would stall.
  createEffect(() => {
    const loadedCount = vouchers().length;
    if (!open() || loadedCount === 0) return;
    const el = sentinel();
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadNext();
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    onCleanup(() => io.disconnect());
  });

  const today = () => new Date().toISOString().slice(0, 10);

  const applicable = createMemo(() => {
    const today_ = today();
    return vouchers().filter((v) => isApplicable(v, props.subtotal, props.packageIds, props.packageLineages ?? [], today_));
  });

  const inapplicable = createMemo(() => {
    const today_ = today();
    return vouchers()
      .filter((v) => !isApplicable(v, props.subtotal, props.packageIds, props.packageLineages ?? [], today_))
      .map((v) => ({
        voucher: v,
        reason: ineligibilityReason(v, props.subtotal, props.packageIds, props.packageLineages ?? [], today_) ?? "",
      }));
  });

  const openPicker = () => {
    if (props.disabled) return;
    setQuery("");
    setDebouncedQuery("");
    setVouchers([]);
    setPage(1);
    setTotal(0);
    setDraft(props.selected);
    setOpen(true);
  };

  const close = () => setOpen(false);

  // Picking a row only stages it; nothing reaches the cart until Confirm, so a
  // mis-tap on a touch screen can be corrected without re-opening the dialog.
  const stage = (v: VoucherOption) => {
    setDraft((current) => (current?.id === v.id ? null : v));
  };

  const confirm = () => {
    props.onChange(draft());
    close();
  };

  const clear = (e: MouseEvent) => {
    e.stopPropagation();
    props.onChange(null);
  };

  const previewDiscount = createMemo(() => calculateDiscount(props.selected, props.subtotal));

  // A fixed_amount description already reads "₱X off"; repeating the computed
  // figure beside it just says the same thing twice.
  const showTriggerAmount = createMemo(
    () => previewDiscount() > 0 && props.selected?.type !== "fixed_amount",
  );

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
    return lo === hi
      ? `−${formatCurrency(hi)}`
      : `−${formatCurrency(lo)} to ${formatCurrency(hi)}`;
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

  const metaLine = (v: VoucherOption): string =>
    [formatExpiry(v.valid_until, today()), formatUsage(v)]
      .filter(Boolean)
      .join(" · ");

  // Staged description, trimmed — the footer read it twice, and a signal call
  // in JSX doesn't narrow across re-evaluations.
  const draftNotes = createMemo(() => {
    const n = draft()?.notes?.trim();
    return n ? n : null;
  });

  // The footer clamps the description to two lines; offer "More" only when the
  // text actually overflowed. Re-measured whenever the staged description changes.
  createEffect(() => {
    const notes = draftNotes();
    const el = descEl;
    if (!notes || !el) {
      setDescOverflowing(false);
      return;
    }
    setDescOverflowing(el.scrollHeight > el.clientHeight);
  });

  const expiresSoon = (v: VoucherOption): boolean => {
    if (!v.valid_until) return false;
    const days = daysUntil(toDay(v.valid_until), today());
    return days >= 0 && days <= 7;
  };

  // Either scarcity signal warrants the amber treatment on the meta line.
  const runningOut = (v: VoucherOption): boolean => expiresSoon(v) || nearlyUsedUp(v);

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
              {/* A fixed-amount voucher already names the peso figure — appending
                  the computed one would just repeat it. */}
              <Show when={showTriggerAmount()}> · {formatCurrency(previewDiscount())} off</Show>
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
                    <Show when={debouncedQuery() !== ""} fallback="No vouchers available.">
                      No voucher matches “{debouncedQuery()}”.
                    </Show>
                  </div>
                </li>
              </Show>
              <For each={applicable()}>
                {(v) => {
                  const selected = () => draft()?.id === v.id;
                  return (
                    <li role="option" aria-selected={selected()}>
                      <button
                        type="button"
                        data-testid={`voucher-picker-result-${v.id}`}
                        onClick={() => stage(v)}
                        class="w-full text-left px-3 py-3 mb-1 rounded-lg border transition-colors flex items-center gap-3 cursor-pointer border-[color-mix(in_srgb,var(--ks-border-strong,#3f3f46)_40%,transparent)] hover:border-[color-mix(in_srgb,var(--ks-primary,#c9a961)_50%,transparent)] hover:bg-[color-mix(in_srgb,var(--ks-primary,#c9a961)_8%,transparent)]"
                        classList={{
                          "border-[color-mix(in_srgb,var(--ks-primary,#c9a961)_60%,transparent)] bg-[color-mix(in_srgb,var(--ks-primary,#c9a961)_12%,transparent)]":
                            selected(),
                        }}
                      >
                        <span class="flex flex-col items-center gap-1 shrink-0">
                          <Ticket size={18} class="text-[var(--ks-success-fg,#34d399)]" aria-hidden="true" />
                          <span class="text-[11px] leading-tight text-center text-[var(--ks-success-fg,#34d399)]">
                            {formatVoucherDescription(v)}
                          </span>
                        </span>
                        <span class="flex-1 min-w-0">
                          <span class="block text-sm font-medium text-[var(--ks-fg,#ffffff)] truncate">
                            {highlightMatch(v.code, debouncedQuery())}
                          </span>
                          <span class="flex items-center gap-1 text-xs text-[var(--ks-fg-subtle,#71717a)] min-w-0">
                            <Show when={runningOut(v)}>
                              <CalendarClock
                                size={12}
                                class="shrink-0 text-[var(--ks-warning-fg,#fbbf24)]"
                                aria-hidden="true"
                              />
                            </Show>
                            <span class="truncate" classList={{ "text-[var(--ks-warning-fg,#fbbf24)]": runningOut(v) }}>
                              {metaLine(v)}
                            </span>
                          </span>
                          <Show when={v.notes && v.notes.trim()}>
                            <span class="block text-xs text-[var(--ks-fg-subtle,#71717a)] truncate">
                              {highlightMatch(v.notes!, debouncedQuery())}
                            </span>
                          </Show>
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
                        <span class="flex flex-col items-center gap-1 shrink-0">
                          <Ticket size={18} class="text-[var(--ks-fg-subtle,#71717a)]" aria-hidden="true" />
                          <span class="text-[11px] leading-tight text-center text-[var(--ks-fg-subtle,#71717a)]">
                            {formatVoucherDescription(entry.voucher)}
                          </span>
                        </span>
                        <span class="flex-1 min-w-0">
                          <span class="block text-sm text-[var(--ks-fg,#ffffff)] truncate">
                            {highlightMatch(entry.voucher.code, debouncedQuery())}
                          </span>
                          <span class="block text-xs text-[var(--ks-fg-subtle,#71717a)] truncate">
                            {metaLine(entry.voucher)}
                          </span>
                          <Show when={entry.voucher.notes && entry.voucher.notes.trim()}>
                            <span class="block text-xs text-[var(--ks-fg-subtle,#71717a)] truncate">
                              {highlightMatch(entry.voucher.notes!, debouncedQuery())}
                            </span>
                          </Show>
                        </span>
                        <span class="text-xs text-[var(--ks-warning-fg,#fbbf24)] shrink-0 text-right max-w-[45%] truncate">
                          {entry.reason}
                        </span>
                      </div>
                    </li>
                  )}
                </For>
              </Show>

              {/* Sentinel: intersecting pulls the next page. */}
              <Show when={hasMore()}>
                <li>
                  <div
                    ref={setSentinel}
                    data-testid="voucher-picker-sentinel"
                    class="px-3 py-3 flex items-center justify-center gap-2 text-xs text-[var(--ks-fg-subtle,#71717a)]"
                  >
                    <Show when={loadingMore()} fallback={<span>Scroll for more</span>}>
                      <Loader2 size={14} class="animate-spin shrink-0" />
                      <span>Loading more…</span>
                    </Show>
                  </div>
                </li>
              </Show>
            </ul>

            {/* Bled to the card edges so the rule spans the full width, matching
                the header. */}
            <div class="-mx-6 -mb-6 mt-4 px-5 sm:px-6 py-3 border-t border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] flex items-center justify-between gap-3 shrink-0">
              <div class="min-w-0 flex flex-col gap-1">
                <Show
                  when={draft()}
                  fallback={
                    <span
                      data-testid="voucher-picker-draft-summary"
                      class="text-xs text-[var(--ks-fg-subtle,#71717a)]"
                    >
                      No voucher selected
                    </span>
                  }
                >
                  <Show when={draftNotes()}>
                    <span class="flex flex-col items-start gap-0.5 min-w-0">
                      <span
                        ref={descEl}
                        data-testid="voucher-picker-draft-description"
                        class="min-w-0 text-xs text-[var(--ks-fg-muted,#a1a1aa)] whitespace-pre-line line-clamp-2"
                      >
                        {draftNotes()}
                      </span>
                      <Show when={descOverflowing()}>
                        <button
                          type="button"
                          data-testid="voucher-picker-expand-description"
                          onClick={() => setDescOpen(true)}
                          class="text-xs leading-tight text-[var(--ks-primary,#c9a961)] hover:underline transition-colors cursor-pointer"
                          aria-label="Show full description"
                        >
                          See more
                        </button>
                      </Show>
                    </span>
                  </Show>
                </Show>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <Show when={props.selected && draft()}>
                  <button
                    type="button"
                    data-testid="voucher-picker-clear-from-list"
                    onClick={() => setDraft(null)}
                    class="px-3 py-2 rounded-lg text-sm text-[var(--ks-danger-fg,#f87171)] hover:bg-[color-mix(in_srgb,var(--ks-danger,#ef4444)_10%,transparent)] transition-colors cursor-pointer"
                  >
                    Remove
                  </button>
                </Show>
                <button
                  type="button"
                  data-testid="voucher-picker-cancel"
                  onClick={close}
                  class="px-3 py-2 rounded-lg text-sm text-[var(--ks-fg-muted,#a1a1aa)] hover:text-[var(--ks-fg,#ffffff)] hover:bg-[color-mix(in_srgb,var(--ks-surface-raised,#1a1a1a)_50%,transparent)] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="voucher-picker-confirm"
                  onClick={confirm}
                  disabled={draft()?.id === props.selected?.id}
                  class="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--ks-primary,#c9a961)] text-[var(--ks-fg-on-accent,#0a0a0a)] hover:opacity-90 transition-opacity cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Show when={props.selected} fallback="Apply voucher">
                    <Show when={draft()} fallback="Remove voucher">
                      Change voucher
                    </Show>
                  </Show>
                </button>
              </div>
            </div>
          </div>
        </Modal>
      </Show>

      {/* Full-description popup: "More" in the footer only appears when the
          clamped text overflowed, but the popup itself is reachable whenever a
          staged description exists. */}
      <Show when={descOpen() && draftNotes()}>
        <Modal onClose={() => setDescOpen(false)} size="md" ariaLabel="Voucher description">
          <div data-testid="voucher-picker-description-popup" class="flex flex-col gap-4">
            <div class="flex items-center justify-between gap-3">
              <h2 class="m-0 text-base font-semibold text-[var(--ks-fg,#ffffff)]">
                Voucher description
              </h2>
              <button
                type="button"
                data-testid="voucher-picker-close-description"
                onClick={() => setDescOpen(false)}
                class="w-8 h-8 flex items-center justify-center rounded text-[var(--ks-fg-muted,#a1a1aa)] hover:text-[var(--ks-fg,#ffffff)] hover:bg-[color-mix(in_srgb,var(--ks-surface-raised,#1a1a1a)_50%,transparent)] transition-colors cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <p class="m-0 text-sm text-[var(--ks-fg,#ffffff)] whitespace-pre-line">
              {draftNotes()}
            </p>
            <div class="flex justify-end">
              <button
                type="button"
                data-testid="voucher-picker-description-close"
                onClick={() => setDescOpen(false)}
                class="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--ks-primary,#c9a961)] text-[var(--ks-fg-on-accent,#0a0a0a)] hover:opacity-90 transition-opacity cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      </Show>
    </>
  );
}
