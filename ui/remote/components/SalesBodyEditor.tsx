// Source: KahitSan/kserp src/components/SalesBodyEditor.tsx (vendored into the plugin remote).
//
// Embedded "Packages availed" editor for the Record Transaction modal. Reuses
// ClientPicker + VoucherPicker (both cross-plugin, both degrade gracefully).
// Fetches the SIBLING packages plugin's public API at /api/packages — when it
// 404s/fails the picker shows an inline notice and the sale can still be
// recorded with a manual amount (the parent hides the package cart but keeps
// the amount field). The outer form owns destination_account_id / payee /
// dates; this component owns items[] + client / voucher / manual-discount.

import { createSignal, createMemo, createEffect, For, Show, onMount } from "solid-js";
import {
  ComboBox,
  type ClientOption,
  VoucherPicker,
  calculateDiscount,
  type VoucherOption,
} from "@kahitsan/ksui";
import UserRound from "lucide-solid/icons/user-round";
import Plus from "lucide-solid/icons/plus";

// Client data-wiring for the generic ComboBox engine. Search/create hit the
// sibling clients plugin's /api/clients endpoint directly. Degrades gracefully
// when the clients plugin isn't deployed.
async function searchClients(query: string): Promise<ClientOption[]> {
  const params = new URLSearchParams({ status: "active", limit: "10" });
  if (query) params.set("search", query);
  const r = await fetch(`/api/clients?${params.toString()}`, { credentials: "include" });
  if (!r.ok) {
    if (r.status === 403) throw new Error("Permission denied");
    if (r.status === 404) throw new Error("Clients module isn't available — type a name instead");
    throw new Error("Failed to load");
  }
  const json = (await r.json()) as { data?: ClientOption[] };
  return json.data ?? [];
}

async function createClient(name: string): Promise<ClientOption> {
  const res = await fetch("/api/clients", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name_raw: name }),
  });
  if (!res.ok && res.status !== 200) {
    const body = (await res.json().catch(() => ({ error: "Failed to create client" }))) as {
      error?: string;
    };
    throw new Error(body.error || "Failed to create client");
  }
  return (await res.json()) as ClientOption;
}

function clientSecondary(c: ClientOption): string | null {
  return [c.email, c.phone].filter(Boolean).join(" · ") || null;
}
import Minus from "lucide-solid/icons/minus";
import Trash2 from "lucide-solid/icons/trash-2";
import PackageIcon from "lucide-solid/icons/package";

interface Variant {
  id: number;
  package_id: number;
  name: string;
  kind: "standard" | "extension" | "bundle";
  duration_value: string | number;
  duration_unit: "hour" | "day" | "month";
  price: string | number;
  currency: string;
  is_active: boolean;
  sort_order: number;
}

interface Package {
  id: number;
  name: string;
  description: string | null;
  type: string;
  is_active: boolean;
  variants: Variant[];
}

export interface SalesLine {
  key: string; // "pkg_id:variant_id"
  package_id: number;
  package_name: string;
  variant_id: number;
  variant_name: string;
  duration_value: number;
  duration_unit: "hour" | "day" | "month";
  unit_price: number;
  quantity: number;
}

export interface SalesBodyEditorProps {
  items: SalesLine[];
  setItems: (next: SalesLine[]) => void;
  client: ClientOption | null;
  setClient: (next: ClientOption | null) => void;
  voucher: VoucherOption | null;
  setVoucher: (next: VoucherOption | null) => void;
  manualDiscount: string;
  setManualDiscount: (next: string) => void;
}

function formatPHP(amount: number): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
}

export default function SalesBodyEditor(props: SalesBodyEditorProps) {
  const [packages, setPackages] = createSignal<Package[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [pickerOpen, setPickerOpen] = createSignal(false);

  onMount(async () => {
    try {
      const res = await fetch("/api/packages", { credentials: "include" });
      if (!res.ok)
        throw new Error(
          res.status === 404 ? "Packages module isn't available" : "Failed to load packages",
        );
      const json = await res.json();
      setPackages((json.data || []).filter((p: Package) => p.is_active));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load packages");
    } finally {
      setLoading(false);
    }
  });

  function addVariant(pkg: Package, variant: Variant) {
    const key = `${pkg.id}:${variant.id}`;
    const existing = props.items.find((l) => l.key === key);
    if (existing) {
      props.setItems(props.items.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l)));
    } else {
      const unitPrice =
        typeof variant.price === "string" ? parseFloat(variant.price) : Number(variant.price);
      const dur =
        typeof variant.duration_value === "string"
          ? parseFloat(variant.duration_value)
          : Number(variant.duration_value);
      props.setItems([
        ...props.items,
        {
          key,
          package_id: pkg.id,
          package_name: pkg.name,
          variant_id: variant.id,
          variant_name: variant.name,
          duration_value: dur,
          duration_unit: variant.duration_unit,
          unit_price: unitPrice,
          quantity: 1,
        },
      ]);
    }
    setPickerOpen(false);
  }

  function adjust(key: string, delta: number) {
    props.setItems(
      props.items
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function remove(key: string) {
    props.setItems(props.items.filter((l) => l.key !== key));
  }

  const subtotal = createMemo(() => props.items.reduce((s, l) => s + l.unit_price * l.quantity, 0));
  const voucherDiscount = createMemo(() => calculateDiscount(props.voucher, subtotal()));
  const manualDiscountNumber = createMemo(() => {
    const n = parseFloat(props.manualDiscount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const effectiveDiscount = createMemo(() =>
    props.voucher ? voucherDiscount() : manualDiscountNumber(),
  );
  const total = createMemo(() => Math.max(0, subtotal() - effectiveDiscount()));
  const cartPackageIds = createMemo(() => props.items.map((l) => l.package_id));

  createEffect(() => {
    const v = props.voucher;
    if (!v) return;
    const sub = subtotal();
    const minOk = sub >= Number(v.minimum_purchase ?? 0);
    const allowed = v.applicable_packages;
    const cartIds = cartPackageIds();
    const pkgsOk =
      !allowed ||
      allowed.length === 0 ||
      (cartIds.length > 0 && cartIds.every((id) => allowed.includes(id)));
    if (!minOk || !pkgsOk) props.setVoucher(null);
  });

  return (
    <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-3">
      <div class="flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-emerald-400 font-semibold">
        <span class="flex items-center gap-1.5">
          <PackageIcon size={12} />
          Packages availed
        </span>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          class="ks-interactive inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/20"
        >
          <Plus size={10} /> Add package
        </button>
      </div>

      <Show when={pickerOpen()}>
        <Show when={!loading()} fallback={<div class="text-xs text-zinc-500">Loading packages…</div>}>
          <Show when={!loadError()} fallback={<div class="text-xs text-rose-400">{loadError()}</div>}>
            <Show
              when={packages().length > 0}
              fallback={<div class="text-xs text-zinc-500">No active packages.</div>}
            >
              <div class="space-y-1.5 max-h-56 overflow-y-auto rounded-md border border-emerald-500/15 p-2 bg-zinc-950/40">
                <For each={packages()}>
                  {(pkg) => (
                    <div class="space-y-1">
                      <div class="text-[11px] uppercase tracking-widest text-zinc-400">{pkg.name}</div>
                      <div class="flex flex-wrap gap-1.5">
                        <For each={pkg.variants.filter((v) => v.is_active)}>
                          {(v) => (
                            <button
                              type="button"
                              onClick={() => addVariant(pkg, v)}
                              class="ks-interactive inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-300"
                            >
                              {v.name} · {formatPHP(Number(v.price))}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>

      <Show
        when={props.items.length > 0}
        fallback={<div class="text-xs text-zinc-500">No packages added yet.</div>}
      >
        <div class="space-y-1.5">
          <For each={props.items}>
            {(line) => (
              <div class="flex items-center gap-2 text-sm">
                <div class="min-w-0 flex-1">
                  <div class="text-zinc-200 truncate">
                    {line.package_name} <span class="text-zinc-500">· {line.variant_name}</span>
                  </div>
                  <div class="text-[11px] text-zinc-500 tabular-nums">
                    {formatPHP(line.unit_price)} · {line.duration_value} {line.duration_unit}
                    {line.duration_value !== 1 ? "s" : ""}
                  </div>
                </div>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => adjust(line.key, -1)}
                    class="ks-interactive flex h-6 w-6 items-center justify-center rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-emerald-500/40"
                    aria-label="Decrease quantity"
                  >
                    <Minus size={12} />
                  </button>
                  <span class="w-6 text-center text-sm text-zinc-200 tabular-nums">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => adjust(line.key, 1)}
                    class="ks-interactive flex h-6 w-6 items-center justify-center rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-emerald-500/40"
                    aria-label="Increase quantity"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div class="w-20 text-right text-zinc-300 tabular-nums whitespace-nowrap">
                  {formatPHP(line.unit_price * line.quantity)}
                </div>
                <button
                  type="button"
                  onClick={() => remove(line.key)}
                  class="ks-interactive flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:text-rose-400"
                  aria-label="Remove line"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            Billed to
          </label>
          <ComboBox<ClientOption>
            selected={props.client}
            onChange={(c) => props.setClient(c)}
            search={searchClients}
            onCreate={createClient}
            idOf={(c) => c.id}
            labelOf={(c) => c.name_raw}
            secondaryOf={clientSecondary}
            icon={UserRound}
            noun="client"
            placeholder="Walk-in"
            testIdPrefix="client-picker"
          />
        </div>
        <div>
          <label class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            Voucher
          </label>
          <VoucherPicker
            selected={props.voucher}
            onChange={(v) => {
              props.setVoucher(v);
              if (v) props.setManualDiscount("");
            }}
            subtotal={subtotal()}
            packageIds={cartPackageIds()}
          />
        </div>
      </div>

      <Show when={!props.voucher}>
        <div>
          <label class="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            Manual discount (₱)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={props.manualDiscount}
            onInput={(e) => props.setManualDiscount(e.currentTarget.value)}
            class="mt-0.5 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200 tabular-nums focus:border-emerald-500/50 focus:outline-none"
          />
        </div>
      </Show>

      <Show when={props.items.length > 0}>
        <div class="border-t border-emerald-500/15 pt-2 text-xs space-y-0.5 tabular-nums">
          <div class="flex items-center justify-between text-zinc-400">
            <span>Subtotal</span>
            <span>{formatPHP(subtotal())}</span>
          </div>
          <Show when={effectiveDiscount() > 0}>
            <div class="flex items-center justify-between text-zinc-400">
              <span>{props.voucher ? `Voucher ${props.voucher.code}` : "Manual discount"}</span>
              <span>− {formatPHP(effectiveDiscount())}</span>
            </div>
          </Show>
          <div class="flex items-center justify-between text-zinc-200 font-semibold">
            <span>Total</span>
            <span>{formatPHP(total())}</span>
          </div>
        </div>
      </Show>
    </div>
  );
}
