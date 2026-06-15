import { Portal } from "solid-js/web";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import Banknote from "lucide-solid/icons/banknote";
import Loader2 from "lucide-solid/icons/loader-2";
import AccountAvatar from "../base/AccountAvatar";

export interface PaymentAccountOption {
  id: number;
  name: string;
  type: string;
  icon?: string | null;
  color?: string | null;
  s3_link?: string | null;
}

interface PaymentAccountPickerProps {
  selected: PaymentAccountOption | null;
  onChange: (next: PaymentAccountOption | null) => void;
  /** Reports the loaded count back up so the modal can disable Charge when zero. */
  onCountChange?: (count: number) => void;
  disabled?: boolean;
}

const POPUP_MAX_HEIGHT = 360;
const POPUP_MIN_WIDTH = 320;

const TYPE_LABELS: Record<string, string> = {
  bank: "Bank",
  e_wallet: "E-Wallet",
  cash: "Cash",
  external: "External",
};

const TYPE_ORDER = ["cash", "e_wallet", "bank", "external"];

function groupAndSort(accounts: PaymentAccountOption[]): Array<[string, PaymentAccountOption[]]> {
  const buckets = new Map<string, PaymentAccountOption[]>();
  for (const a of accounts) {
    const key = a.type ?? "external";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(a);
  }
  for (const list of buckets.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  // Preserve a deterministic order for the type sections so the picker
  // doesn't shuffle between renders or between orgs with different account
  // mixes. Unknown types append at the end.
  const sections: Array<[string, PaymentAccountOption[]]> = [];
  for (const t of TYPE_ORDER) {
    const list = buckets.get(t);
    if (list && list.length > 0) sections.push([t, list]);
  }
  for (const [t, list] of buckets.entries()) {
    if (!TYPE_ORDER.includes(t)) sections.push([t, list]);
  }
  return sections;
}

export default function PaymentAccountPicker(props: PaymentAccountPickerProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [accounts, setAccounts] = createSignal<PaymentAccountOption[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});

  let triggerRef: HTMLButtonElement | undefined;
  let popupRef: HTMLDivElement | undefined;
  let activeFetchToken = 0;

  // Fetch once on mount and report the count to the parent. We don't refetch
  // on every open since the account list rarely changes mid-cart and the
  // count is also what governs whether Charge is allowed at all (zero
  // accounts means the user can't pay into anything).
  const reportCount = (n: number) => props.onCountChange?.(n);
  const fetchAccounts = async () => {
    const token = ++activeFetchToken;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/financial-accounts?status=active&limit=200");
      if (!r.ok) throw new Error(r.status === 403 ? "Permission denied" : "Failed to load");
      const json = await r.json();
      if (token !== activeFetchToken) return;
      const list = (json.data || []) as PaymentAccountOption[];
      setAccounts(list);
      reportCount(list.length);
    } catch (e) {
      if (token !== activeFetchToken) return;
      setError(e instanceof Error ? e.message : "Failed to load");
      setAccounts([]);
      reportCount(0);
    } finally {
      if (token === activeFetchToken) setLoading(false);
    }
  };

  // Single fetch at mount. The list rarely changes within a cart session,
  // and Charge gating already depends on the count it reports up via
  // onCountChange. If the picker ever needs to refetch on org switch,
  // swap this for a createEffect tracking the active-org signal.
  onMount(() => {
    void fetchAccounts();
  });

  // Auto-select the first account once the list loads, so a single-account
  // org doesn't have to tap to charge. Skips when something is already
  // selected (preserves an explicit reset to null).
  createEffect(() => {
    if (props.selected) return;
    if (loading()) return;
    const first = accounts()[0];
    if (first) props.onChange(first);
  });

  const sections = createMemo(() => groupAndSort(accounts()));
  const noAccounts = () => !loading() && accounts().length === 0;

  const updatePosition = () => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const vpHeight = window.innerHeight;
    const vpWidth = window.innerWidth;
    const width = Math.max(POPUP_MIN_WIDTH, rect.width);
    const spaceBelow = vpHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp = spaceBelow < POPUP_MAX_HEIGHT && spaceAbove > spaceBelow;
    const top = flipUp ? Math.max(8, rect.top - POPUP_MAX_HEIGHT - 4) : rect.bottom + 4;
    const maxHeight = Math.max(
      200,
      Math.min(POPUP_MAX_HEIGHT, flipUp ? spaceAbove - 12 : spaceBelow - 12),
    );
    const left = Math.min(Math.max(8, rect.left), vpWidth - width - 8);
    setPopupStyle({
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      "max-height": `${maxHeight}px`,
    });
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

  const select = (a: PaymentAccountOption) => {
    props.onChange(a);
    setOpen(false);
  };

  const triggerDisabled = () => props.disabled || noAccounts();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="payment-account-picker-trigger"
        disabled={triggerDisabled()}
        onClick={() => !triggerDisabled() && setOpen((o) => !o)}
        title={
          noAccounts()
            ? "Ask an admin to grant access to a financial account before charging."
            : undefined
        }
        class="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-800/30 border border-zinc-700/50 hover:border-amber-500/40 hover:bg-amber-500/5 transition-colors text-sm text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={open()}
      >
        <Show when={loading()} fallback={null}>
          <Loader2 size={14} class="animate-spin text-zinc-500 shrink-0" aria-hidden="true" />
        </Show>
        <Show when={!loading()}>
          <Show
            when={props.selected}
            fallback={
              <Show
                when={noAccounts()}
                fallback={
                  <>
                    <Banknote size={16} class="shrink-0 text-zinc-400" aria-hidden="true" />
                    <span class="text-zinc-500 italic">Choose payment account</span>
                  </>
                }
              >
                <Banknote size={16} class="shrink-0 text-zinc-500" aria-hidden="true" />
                <span class="text-zinc-500 italic">No accessible accounts</span>
              </Show>
            }
          >
            {(acct) => (
              <>
                <AccountAvatar account={acct()} size={28} />
                <span class="flex-1 min-w-0">
                  <span class="block truncate text-zinc-100 font-medium">{acct().name}</span>
                  <span class="block truncate text-[11px] text-zinc-500">
                    {TYPE_LABELS[acct().type] ?? acct().type}
                  </span>
                </span>
              </>
            )}
          </Show>
        </Show>
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={popupRef}
            data-testid="payment-account-picker-popup"
            class="z-[100] rounded-md border border-zinc-700 bg-zinc-900/95 backdrop-blur shadow-xl overflow-hidden flex flex-col"
            style={popupStyle()}
          >
            <div class="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
              <Banknote size={14} class="text-zinc-500 shrink-0" aria-hidden="true" />
              <span class="text-xs uppercase tracking-widest text-zinc-500 font-bold">
                Payment account
              </span>
              <Show when={loading()}>
                <Loader2 size={14} class="animate-spin text-zinc-500 ml-auto shrink-0" />
              </Show>
            </div>
            <div class="flex-1 overflow-y-auto">
              <Show when={error()}>
                <div role="status" class="px-3 py-2 text-xs text-red-400">
                  {error()}
                </div>
              </Show>
              <Show when={!loading() && !error() && accounts().length === 0}>
                <div role="status" class="px-3 py-4 text-xs text-zinc-500 text-center">
                  No accessible accounts. Ask an admin to grant access.
                </div>
              </Show>
              <For each={sections()}>
                {([type, list]) => (
                  <div>
                    <div class="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-600 font-semibold">
                      {TYPE_LABELS[type] ?? type}
                    </div>
                    <ul
                      role="listbox"
                      aria-label={`${TYPE_LABELS[type] ?? type} accounts`}
                      class="m-0 p-0 list-none"
                    >
                      <For each={list}>
                        {(a) => {
                          const selected = () => props.selected?.id === a.id;
                          return (
                            <li role="option" aria-selected={selected()}>
                              <button
                                type="button"
                                data-testid={`payment-account-picker-result-${a.id}`}
                                onClick={() => select(a)}
                                class="w-full text-left px-3 py-2 hover:bg-amber-500/10 transition-colors flex items-center gap-2 cursor-pointer"
                              >
                                <AccountAvatar account={a} size={28} />
                                <span class="flex-1 min-w-0 text-sm text-zinc-100 truncate">
                                  {a.name}
                                </span>
                                <Show when={selected()}>
                                  <span class="text-amber-400 shrink-0">✓</span>
                                </Show>
                              </button>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
