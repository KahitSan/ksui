// Adapted from KahitSan/kserp src/components/PaymentLegModal.tsx for the
// isolated transactions plugin.
//
// The monolith modal drove a full PaymentCaptureStep with per-customer
// attribution and a PUT-to-edit-leg path. The fork's transactions server
// exposes a simpler payment surface: GET /:id (returns payments + balance),
// POST /:id/payments { financial_account_id, amount, notes }, and DELETE
// /:id/payments/:pid. There is no PUT and no customer_group model. So this
// version keeps the same consolidated ledger shape — a payment-history list
// with delete + a "record another tender" form — backed by exactly those
// routes. The account picker fetches the SIBLING financial-accounts plugin and
// degrades to a numeric account-id input when that's unavailable.

import { Portal } from "solid-js/web";
import { createSignal, createMemo, Show, onCleanup, onMount, For } from "solid-js";
import { autoFocusOnMount, useFocusTrap, confirm } from "@kserp/host-ui";
import { Button } from "@kserp/host-ui";
import AccountAvatar from "./AccountAvatar";
import { useAccountsIndex, resolveAccount } from "../lib/accounts-index";
import X from "lucide-solid/icons/x";
import Loader2 from "lucide-solid/icons/loader-2";
import AlertCircle from "lucide-solid/icons/alert-circle";
import Trash2 from "lucide-solid/icons/trash-2";
import Plus from "lucide-solid/icons/plus";

interface TransactionPayment {
  id: number;
  financial_account_id: number;
  financial_account_name: string | null;
  amount: string;
  notes: string | null;
  created_at: string;
}

interface TransactionRow {
  id: number;
  amount: string;
  payments?: TransactionPayment[];
  balance?: string;
}

interface FinancialAccount {
  id: number;
  name: string;
  type: string;
}

interface Props {
  transactionId: number;
  // "list" gives the ledger view; "settle" / "edit-leg" both expand the add
  // form (the fork can't PUT an existing leg, so edit-leg falls back to the
  // add form pre-pointed at that leg's account/amount for a quick re-record).
  mode: "list" | "settle" | "edit-leg";
  legId?: number;
  onClose: () => void;
  onSuccess: () => void;
  onSwitchTarget?: (target: { mode: "list" | "settle" | "edit-leg"; legId?: number }) => void;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
}

export default function PaymentLegModal(props: Props) {
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [txn, setTxn] = createSignal<TransactionRow | null>(null);
  const [accounts, setAccounts] = createSignal<FinancialAccount[]>([]);
  const [accountsAvailable, setAccountsAvailable] = createSignal(true);
  const [deletingId, setDeletingId] = createSignal<number | null>(null);

  // Add-form state.
  const [formAccount, setFormAccount] = createSignal("");
  const [formAmount, setFormAmount] = createSignal("");
  const [formNotes, setFormNotes] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const accountsIndex = useAccountsIndex();

  const isList = createMemo(() => props.mode === "list");

  const outstanding = createMemo<number>(() => {
    const t = txn();
    if (!t) return 0;
    return t.balance != null ? Number(t.balance) : 0;
  });

  const formatDate = (s: string) => {
    const d = new Date(s);
    const date = d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
    const time = d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });
    return `${date} · ${time}`;
  };

  async function loadAccounts() {
    try {
      const res = await fetch("/api/financial-accounts?status=active&limit=200", {
        credentials: "include",
      });
      if (!res.ok) {
        setAccountsAvailable(false);
        return;
      }
      const json = await res.json();
      setAccounts((json.data || []) as FinancialAccount[]);
    } catch {
      setAccountsAvailable(false);
    }
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/transactions/${props.transactionId}`, { credentials: "include" });
      if (!res.ok) {
        setLoadError(res.status === 403 ? "Permission denied" : "Failed to load transaction");
        return;
      }
      const row = (await res.json()) as TransactionRow;
      setTxn(row);
      // Seed the add form from the targeted leg (edit-leg) or the outstanding
      // balance (settle) so a quick re-record needs minimal typing.
      const leg = (row.payments ?? []).find((p) => p.id === props.legId) ?? null;
      if (props.mode === "edit-leg" && leg) {
        setFormAccount(String(leg.financial_account_id));
        setFormAmount(leg.amount);
        setFormNotes(leg.notes ?? "");
      } else if (props.mode === "settle") {
        const bal = row.balance != null ? Number(row.balance) : 0;
        if (bal > 0) setFormAmount(bal.toFixed(2));
      }
    } catch {
      setLoadError("Network error — close and try again.");
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    void load();
    void loadAccounts();
  });

  async function handleDeletePayment(legId: number) {
    const ok = await confirm({
      title: "Delete this payment?",
      message:
        "This removes the payment leg from the receipt. The outstanding balance will increase to reflect what's still due.",
      confirmLabel: "Delete payment",
      danger: true,
    });
    if (!ok) return;
    setDeletingId(legId);
    try {
      const res = await fetch(`/api/transactions/${props.transactionId}/payments/${legId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) return;
      await load();
      props.onSuccess();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAddPayment() {
    setSaveError(null);
    const amt = parseFloat(formAmount());
    if (!Number.isFinite(amt) || amt <= 0) {
      setSaveError("Enter a payment amount greater than 0.");
      return;
    }
    const accId = parseInt(formAccount(), 10);
    if (!Number.isFinite(accId)) {
      setSaveError("Pick a payment account.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/transactions/${props.transactionId}/payments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financial_account_id: accId,
          amount: amt,
          notes: formNotes().trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(body.error ?? "Failed to record payment");
        return;
      }
      setFormNotes("");
      setFormAmount("");
      await load();
      props.onSuccess();
      // After a successful add, return to the ledger view.
      if (props.onSwitchTarget) props.onSwitchTarget({ mode: "list" });
    } catch {
      setSaveError("Network error — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Portal>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div
          ref={(el) => {
            autoFocusOnMount(el);
            onCleanup(useFocusTrap(el));
          }}
          role="dialog"
          aria-modal="true"
          aria-label={isList() ? "Payment history" : "Record payment"}
          class="relative z-10 m-2 sm:m-4 w-full max-w-md max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] card-bg border border-amber-500/30 rounded-xl flex flex-col shadow-2xl"
          data-testid="payment-leg-modal"
          data-mode={props.mode}
        >
          <button
            type="button"
            onClick={() => props.onClose()}
            aria-label="Close"
            data-testid="payment-leg-close"
            class="absolute -top-2.5 -right-2.5 z-30 w-7 h-7 rounded-full bg-zinc-900 border border-zinc-700/80 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 hover:border-zinc-600 transition-colors cursor-pointer flex items-center justify-center shadow-lg"
          >
            <X size={14} />
          </button>

          <Show when={loading()}>
            <div class="flex-1 min-h-0 flex flex-col overflow-hidden bg-zinc-900/30">
              <header class="border-b border-zinc-800/50 px-4 py-3 bg-zinc-900/50">
                <div class="h-2.5 w-24 rounded ks-shimmer" />
              </header>
              <div class="flex-1 overflow-hidden p-2 space-y-1.5">
                <div class="rounded-md border border-zinc-800/60 bg-zinc-900/40 px-2.5 py-2 space-y-1.5">
                  <div class="h-2.5 w-32 rounded ks-shimmer" />
                  <div class="h-2.5 w-full rounded ks-shimmer" />
                </div>
              </div>
            </div>
          </Show>

          <Show when={!loading() && loadError()}>
            <div class="flex flex-col items-center text-center gap-3 px-6 py-8">
              <div class="w-9 h-9 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
                <AlertCircle size={18} class="text-amber-300" />
              </div>
              <p class="text-sm text-zinc-200 leading-snug" data-testid="payment-leg-load-error">
                {loadError()}
              </p>
              <Button intent="primary" variant="clip1" onClick={() => props.onClose()}>
                Close
              </Button>
            </div>
          </Show>

          <Show when={!loading() && !loadError() && txn()}>
            <div class="flex-1 min-h-0 flex flex-col overflow-hidden" data-testid="payment-leg-history">
              <header class="border-b border-zinc-800/50 px-4 py-3 bg-zinc-900/50 flex items-center justify-between gap-2">
                <div>
                  <div class="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-400">
                    Payment history
                  </div>
                  <p class="text-[10px] text-zinc-500 mt-0.5 leading-tight">
                    Past payments on this sale. Add another tender below.
                  </p>
                </div>
                <Show when={txn()?.balance != null}>
                  <div class="shrink-0 text-right">
                    <div
                      class={`text-[9px] font-bold tracking-widest uppercase ${
                        outstanding() <= 0 ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      Outstanding
                    </div>
                    <div
                      class={`text-sm font-bold tabular-nums ${
                        outstanding() <= 0 ? "text-emerald-300" : "text-amber-300"
                      }`}
                      data-testid="record-payment-balance"
                    >
                      {formatCurrency(outstanding())}
                    </div>
                  </div>
                </Show>
              </header>

              <div class="flex-1 overflow-y-auto p-2 space-y-1.5">
                <Show
                  when={(txn()?.payments?.length ?? 0) > 0}
                  fallback={
                    <p
                      class="rounded-md border border-zinc-800/60 bg-zinc-900/40 px-3 py-4 text-[11px] text-zinc-500 text-center"
                      data-testid="payment-leg-history-empty"
                    >
                      No payments recorded yet.
                    </p>
                  }
                >
                  <For each={txn()?.payments ?? []}>
                    {(p) => (
                      <div
                        data-testid={`payment-leg-history-${p.id}`}
                        class="rounded-md border border-zinc-800/60 bg-zinc-900/40 px-2.5 py-2"
                      >
                        <div class="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                          <span class="tabular-nums font-medium text-zinc-300">
                            TP#{p.id}
                            <span class="text-zinc-600 font-normal">
                              {" · "}
                              {formatDate(p.created_at)}
                            </span>
                          </span>
                          <button
                            type="button"
                            aria-label="Delete payment"
                            data-testid={`payment-leg-history-${p.id}-delete`}
                            onClick={() => void handleDeletePayment(p.id)}
                            disabled={deletingId() === p.id}
                            class="ks-interactive inline-flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Delete payment"
                          >
                            <Show when={deletingId() === p.id} fallback={<Trash2 size={12} />}>
                              <Loader2 size={12} class="animate-spin" />
                            </Show>
                          </button>
                        </div>
                        <div class="mt-1 w-full flex items-center gap-1.5 min-w-0">
                          <Show when={resolveAccount(accountsIndex(), p.financial_account_id)}>
                            {(a) => <AccountAvatar account={a()} size={16} />}
                          </Show>
                          <span class="text-[11px] text-zinc-300 truncate flex-1">
                            {p.financial_account_name ?? `Account #${p.financial_account_id}`}
                          </span>
                          <span class="text-[11px] font-semibold tabular-nums text-zinc-100 shrink-0">
                            {formatCurrency(parseFloat(p.amount))}
                          </span>
                        </div>
                        <Show when={p.notes}>
                          <div class="mt-1 text-[10px] text-zinc-500 truncate">{p.notes}</div>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
              </div>

              {/* Add-payment form. Always available (the fork models add, not
                  edit) so the cashier can record another tender straight from
                  the ledger. */}
              <div class="border-t border-zinc-800/50 px-4 py-3 bg-zinc-900/40 space-y-2">
                <div class="text-[10px] font-bold tracking-[0.2em] uppercase text-amber-400 flex items-center gap-1.5">
                  <Plus size={12} /> Record a payment
                </div>
                <Show when={saveError()}>
                  <p
                    class="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-400"
                    data-testid="payment-leg-error"
                  >
                    {saveError()}
                  </p>
                </Show>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
                      Account
                    </label>
                    <Show
                      when={accountsAvailable()}
                      fallback={
                        <input
                          type="number"
                          value={formAccount()}
                          onInput={(e) => setFormAccount(e.currentTarget.value)}
                          placeholder="Account ID"
                          data-testid="payment-leg-account-input"
                          class="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/50 focus:outline-none"
                        />
                      }
                    >
                      <select
                        value={formAccount()}
                        onChange={(e) => setFormAccount(e.currentTarget.value)}
                        data-testid="payment-leg-account-select"
                        class="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 cursor-pointer focus:border-amber-500/50 focus:outline-none"
                      >
                        <option value="">Select…</option>
                        <For each={accounts()}>{(a) => <option value={a.id}>{a.name}</option>}</For>
                      </select>
                    </Show>
                  </div>
                  <div>
                    <label class="block text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
                      Amount (₱)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={formAmount()}
                      onInput={(e) => setFormAmount(e.currentTarget.value)}
                      placeholder="0.00"
                      data-testid="payment-leg-amount"
                      class="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 tabular-nums focus:border-amber-500/50 focus:outline-none"
                    />
                  </div>
                </div>
                <input
                  type="text"
                  value={formNotes()}
                  onInput={(e) => setFormNotes(e.currentTarget.value)}
                  placeholder="Notes (optional)"
                  data-testid="payment-leg-notes"
                  class="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/50 focus:outline-none"
                />
                <div class="flex justify-end gap-2 pt-1">
                  <Button intent="secondary" variant="ghost" onClick={() => props.onClose()}>
                    Close
                  </Button>
                  <Button
                    intent="primary"
                    variant="clip1"
                    onClick={handleAddPayment}
                    disabled={saving()}
                    data-testid="payment-leg-submit"
                  >
                    {saving() ? "Saving…" : "Record payment"}
                  </Button>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Portal>
  );
}
