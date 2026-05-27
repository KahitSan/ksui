// Remote UI module for the transactions plugin.
//
// Built to an IIFE the PLUGIN PROCESS serves (server/main.ts → /_ui). The
// host's generic catch-all route loads it at runtime, keyed off the manifest's
// uiRouteBase ("transactions"), and renders <Component/> in its own component
// tree. solid-js and the host UI kit are EXTERNALIZED to host globals (see
// vite.remote.config.ts) so this runs on the host's single Solid runtime and
// reuses the exact host components — a UI change ships by reloading ONLY the
// plugin process, no host rebuild.
//
// Reproduces the monolith transactions screens (scoped to the core): a list
// with category/status/subcategory/date filters + search + pagination; a
// create modal (category + subcategory + account picker + amount + date); a
// detail modal showing line items / payments / edits; soft-delete (void); and
// subcategory management.
import { createResource, createSignal, For, Show, type JSX } from "solid-js";
import { Button, PageShell, confirm } from "@kserp/host-ui";
import Receipt from "lucide-solid/icons/receipt";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import Settings from "lucide-solid/icons/settings-2";
import Trash2 from "lucide-solid/icons/trash-2";

type Category = "expense" | "sale" | "business" | "payable";

interface Transaction {
  id: number;
  category: Category;
  subcategory: string | null;
  amount: string;
  description: string;
  notes: string | null;
  transaction_date: string;
  status: string;
  reference_number: string | null;
  created_by: string;
  created_at: string;
  amount_collected?: string | null;
  balance?: string | null;
  payment_status?: string | null;
  attachment_count?: string | number;
}

interface ListResponse {
  data: Transaction[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Subcategory {
  id: number;
  name: string;
  applies_to: "income" | "expense";
  sort_order: number;
  is_active: boolean;
}

interface LineItem {
  id: number;
  description: string;
  quantity: number;
  unit_price: string;
  package_name: string | null;
  variant_name: string | null;
  client_name: string | null;
  status: string;
}

interface Payment {
  id: number;
  financial_account_id: number;
  amount: string;
  created_at: string;
}

interface Detail extends Transaction {
  line_items: LineItem[];
  payments: Payment[];
  edits: { id: number; reason: string; kind: string; edited_at: string; edited_by: string }[];
  client_name: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  expense: "Expense",
  sale: "Sale",
  business: "Transfer",
  payable: "Payable",
};

const PAGE_SIZE = 25;
const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/50 focus:outline-none";

function peso(v: string | number | null | undefined): string {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    Number.isFinite(n) ? (n as number) : 0,
  );
}

export function Component() {
  const [search, setSearch] = createSignal("");
  const [categoryFilter, setCategoryFilter] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("active");
  const [page, setPage] = createSignal(1);

  const [list, { refetch }] = createResource(
    () => ({ search: search(), category: categoryFilter(), status: statusFilter(), page: page() }),
    async (key): Promise<ListResponse> => {
      const q = new URLSearchParams({
        page: String(key.page),
        limit: String(PAGE_SIZE),
        search: key.search,
        status: key.status,
      });
      if (key.category) q.set("category", key.category);
      const res = await fetch(`/api/transactions?${q}`, { credentials: "include" });
      if (!res.ok) return { data: [], total: 0, page: 1, limit: PAGE_SIZE, totalPages: 0 };
      return (await res.json()) as ListResponse;
    },
  );
  const rows = () => list()?.data ?? [];
  const total = () => list()?.total ?? 0;
  const totalPages = () => list()?.totalPages ?? 0;

  const [createOpen, setCreateOpen] = createSignal(false);
  const [subcatOpen, setSubcatOpen] = createSignal(false);
  const [detail, setDetail] = createSignal<Detail | null>(null);

  async function openDetail(id: number) {
    const res = await fetch(`/api/transactions/${id}`, { credentials: "include" });
    if (res.ok) setDetail((await res.json()) as Detail);
  }

  async function handleVoid(id: number) {
    if (
      !(await confirm({
        title: "Void this transaction?",
        message: "It will be marked voided and excluded from the active list.",
        confirmLabel: "Void",
        danger: true,
      }))
    )
      return;
    await fetch(`/api/transactions/${id}`, { method: "DELETE", credentials: "include" });
    setDetail(null);
    refetch();
  }

  return (
    <PageShell
      icon={<Receipt size={20} />}
      title="Transactions"
      subtitle="Income, expenses, transfers, and Counter sales"
      actions={
        <div class="flex items-center gap-2">
          <Button
            intent="secondary"
            variant="ghost"
            icon={Settings}
            data-testid="transactions-subcat-btn"
            onClick={() => setSubcatOpen(true)}
          >
            Categories
          </Button>
          <Button
            intent="primary"
            variant="clip1"
            icon={Plus}
            data-testid="transactions-add-btn"
            onClick={() => setCreateOpen(true)}
          >
            New Transaction
          </Button>
        </div>
      }
    >
      {/* Filters */}
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <div class="flex rounded-lg border border-zinc-800/50 overflow-hidden">
          <For each={["active", "completed", "voided"]}>
            {(s) => (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter(s);
                  setPage(1);
                }}
                class="px-3 py-1.5 text-xs capitalize transition-colors cursor-pointer"
                classList={{
                  "bg-amber-500/20 text-amber-400": statusFilter() === s,
                  "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50": statusFilter() !== s,
                }}
              >
                {s}
              </button>
            )}
          </For>
        </div>
        <select
          data-testid="transactions-category-filter"
          value={categoryFilter()}
          onChange={(e) => {
            setCategoryFilter(e.currentTarget.value);
            setPage(1);
          }}
          class="rounded-lg border border-zinc-800/50 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 cursor-pointer"
        >
          <option value="">All categories</option>
          <option value="sale">Sales</option>
          <option value="expense">Expenses</option>
          <option value="payable">Payables</option>
          <option value="business">Transfers</option>
        </select>
        <input
          type="search"
          data-testid="transactions-search"
          value={search()}
          onInput={(e) => {
            setSearch(e.currentTarget.value);
            setPage(1);
          }}
          placeholder="Search description or notes..."
          class="ml-auto w-64 rounded-lg border border-zinc-800/50 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-amber-500/50 focus:outline-none"
        />
      </div>

      {/* List */}
      <div class="card-bg rounded-xl border border-zinc-800 overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wider text-zinc-500">
              <th class="px-4 py-3 font-medium">Date</th>
              <th class="px-4 py-3 font-medium">Description</th>
              <th class="px-4 py-3 font-medium">Category</th>
              <th class="px-4 py-3 font-medium text-right">Amount</th>
              <th class="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            <Show
              when={rows().length > 0}
              fallback={
                <tr>
                  <td colspan={5} class="px-4 py-8 text-center text-xs text-zinc-600 italic">
                    {search() || categoryFilter() || statusFilter() !== "active"
                      ? "No transactions match your filters."
                      : "No transactions yet. Click 'New Transaction' to create one."}
                  </td>
                </tr>
              }
            >
              <For each={rows()}>
                {(row) => (
                  <tr class="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/20">
                    <td class="px-4 py-3 text-zinc-400 whitespace-nowrap">{row.transaction_date}</td>
                    <td class="px-4 py-3">
                      <button
                        type="button"
                        data-testid={`transactions-row-${row.id}`}
                        class="text-left text-zinc-200 hover:text-amber-400 transition-colors cursor-pointer"
                        onClick={() => openDetail(row.id)}
                      >
                        {row.description}
                      </button>
                    </td>
                    <td class="px-4 py-3 text-zinc-400">{CATEGORY_LABELS[row.category] || row.category}</td>
                    <td class="px-4 py-3 text-right tabular-nums text-zinc-200">{peso(row.amount)}</td>
                    <td class="px-4 py-3">
                      <StatusChip status={row.status} />
                    </td>
                  </tr>
                )}
              </For>
            </Show>
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <Show when={totalPages() > 1}>
        <div class="mt-3 flex items-center justify-between text-xs text-zinc-500">
          <span>
            {total()} transaction{total() === 1 ? "" : "s"} · page {page()} of {totalPages()}
          </span>
          <div class="flex gap-2">
            <button
              type="button"
              disabled={page() <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              class="ks-interactive rounded border border-zinc-800 px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page() >= totalPages()}
              onClick={() => setPage((p) => Math.min(totalPages(), p + 1))}
              class="ks-interactive rounded border border-zinc-800 px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </Show>

      <Show when={createOpen()}>
        <CreateModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            setPage(1);
            refetch();
          }}
        />
      </Show>

      <Show when={subcatOpen()}>
        <SubcategoryModal onClose={() => setSubcatOpen(false)} />
      </Show>

      <Show when={detail()}>
        {(t) => (
          <DetailModal txn={t()} onClose={() => setDetail(null)} onVoid={() => handleVoid(t().id)} />
        )}
      </Show>
    </PageShell>
  );
}

function StatusChip(props: { status: string }) {
  const map: Record<string, string> = {
    completed: "border border-emerald-400/40 text-emerald-400 bg-emerald-500/20",
    pending: "border border-amber-400/40 text-amber-400 bg-amber-500/20",
    voided: "border border-zinc-700 text-zinc-500 bg-zinc-800/50",
  };
  return (
    <span
      class={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${map[props.status] || map.completed}`}
    >
      {props.status}
    </span>
  );
}

function ModalShell(props: { onClose: () => void; children: JSX.Element; wide?: boolean }) {
  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        class="card-bg-solid w-full rounded-xl border border-zinc-800 p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        classList={{ "max-w-2xl": props.wide, "max-w-lg": !props.wide }}
      >
        {props.children}
      </div>
    </div>
  );
}

function ModalHeader(props: { title: string; onClose: () => void; actions?: JSX.Element }) {
  return (
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-lg font-semibold text-zinc-100">{props.title}</h2>
      <div class="flex items-center gap-2">
        {props.actions}
        <button
          type="button"
          onClick={props.onClose}
          class="text-zinc-500 hover:text-zinc-300 cursor-pointer p-1"
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </div>
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

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function CreateModal(props: { onClose: () => void; onCreated: () => void }) {
  const [category, setCategory] = createSignal<Category>("expense");
  const [subcategory, setSubcategory] = createSignal("");
  const [amount, setAmount] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [date, setDate] = createSignal(todayIso());
  const [reference, setReference] = createSignal("");
  const [destAccount, setDestAccount] = createSignal("");
  const [srcAccount, setSrcAccount] = createSignal("");
  const [payableKind, setPayableKind] = createSignal("utility");
  const [backdateReason, setBackdateReason] = createSignal("");
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  const appliesTo = () => (category() === "sale" ? "income" : category() === "business" ? null : "expense");

  // Subcategory options for the current category.
  const [subcats] = createResource(appliesTo, async (at) => {
    if (!at) return [] as Subcategory[];
    const res = await fetch(`/api/transactions/subcategories?applies_to=${at}`, { credentials: "include" });
    if (!res.ok) return [] as Subcategory[];
    return ((await res.json()) as { subcategories: Subcategory[] }).subcategories;
  });

  const isBackdated = () => date() !== todayIso();

  async function submit() {
    if (!amount() || parseFloat(amount()) <= 0) {
      setError("Amount must be greater than 0");
      return;
    }
    if (!description().trim()) {
      setError("Description is required");
      return;
    }
    if (isBackdated() && !backdateReason().trim()) {
      setError("A reason is required when backdating");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        category: category(),
        subcategory: subcategory() || null,
        amount: parseFloat(amount()),
        description: description().trim(),
        notes: notes().trim() || null,
        transaction_date: date(),
        reference_number: reference().trim() || null,
        destination_account_id: destAccount() ? parseInt(destAccount(), 10) : null,
        source_account_id: srcAccount() ? parseInt(srcAccount(), 10) : null,
      };
      if (category() === "payable") body.payable_kind = payableKind();
      if (isBackdated()) body.backdate_reason = backdateReason().trim();
      const res = await fetch("/api/transactions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}) as { error?: string });
        setError(e.error || "Failed to create transaction");
        return;
      }
      props.onCreated();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={props.onClose}>
      <div data-testid="transactions-create-modal">
        <ModalHeader title="New Transaction" onClose={props.onClose} />
        <form
          class="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Show when={error()}>
            <div
              data-testid="transactions-form-error"
              class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
            >
              {error()}
            </div>
          </Show>

          <FormField label="Category">
            <select
              data-testid="transactions-form-category"
              value={category()}
              onChange={(e) => {
                setCategory(e.currentTarget.value as Category);
                setSubcategory("");
              }}
              class={`${inputClass} cursor-pointer`}
            >
              <option value="expense">Expense</option>
              <option value="sale">Sale</option>
              <option value="payable">Payable</option>
              <option value="business">Transfer</option>
            </select>
          </FormField>

          <Show when={appliesTo()}>
            <FormField label="Subcategory">
              <select
                data-testid="transactions-form-subcategory"
                value={subcategory()}
                onChange={(e) => setSubcategory(e.currentTarget.value)}
                class={`${inputClass} cursor-pointer`}
              >
                <option value="">— none —</option>
                <For each={subcats() ?? []}>{(s) => <option value={s.name}>{s.name}</option>}</For>
              </select>
            </FormField>
          </Show>

          <Show when={category() === "payable"}>
            <FormField label="Payable kind">
              <select
                value={payableKind()}
                onChange={(e) => setPayableKind(e.currentTarget.value)}
                class={`${inputClass} cursor-pointer`}
              >
                <For each={["subscription", "utility", "rent", "loan", "tax", "other"]}>
                  {(k) => <option value={k}>{k}</option>}
                </For>
              </select>
            </FormField>
          </Show>

          <FormField label="Amount (PHP) *">
            <input
              type="number"
              step="0.01"
              min="0"
              data-testid="transactions-form-amount"
              value={amount()}
              onInput={(e) => setAmount(e.currentTarget.value)}
              class={inputClass}
              placeholder="0.00"
              required
            />
          </FormField>

          <FormField label="Description *">
            <input
              type="text"
              data-testid="transactions-form-description"
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
              class={inputClass}
              placeholder='e.g. "MERALCO May bill"'
              required
            />
          </FormField>

          <div class="grid grid-cols-2 gap-3">
            <FormField label="Date">
              <input
                type="date"
                data-testid="transactions-form-date"
                value={date()}
                onInput={(e) => setDate(e.currentTarget.value)}
                class={inputClass}
              />
            </FormField>
            <FormField label="Reference #">
              <input
                type="text"
                value={reference()}
                onInput={(e) => setReference(e.currentTarget.value)}
                class={inputClass}
                placeholder="Optional"
              />
            </FormField>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <FormField label="Source account ID">
              <input
                type="number"
                value={srcAccount()}
                onInput={(e) => setSrcAccount(e.currentTarget.value)}
                class={inputClass}
                placeholder="Optional"
              />
            </FormField>
            <FormField label="Destination account ID">
              <input
                type="number"
                value={destAccount()}
                onInput={(e) => setDestAccount(e.currentTarget.value)}
                class={inputClass}
                placeholder="Optional"
              />
            </FormField>
          </div>

          <Show when={isBackdated()}>
            <FormField label="Backdate reason *">
              <input
                type="text"
                data-testid="transactions-form-backdate-reason"
                value={backdateReason()}
                onInput={(e) => setBackdateReason(e.currentTarget.value)}
                class={inputClass}
                placeholder="Why is this dated in the past/future?"
              />
            </FormField>
          </Show>

          <FormField label="Notes">
            <textarea
              value={notes()}
              onInput={(e) => setNotes(e.currentTarget.value)}
              class={`${inputClass} resize-none`}
              rows={2}
              placeholder="Optional notes..."
            />
          </FormField>

          <div class="flex justify-end gap-3 pt-2">
            <Button intent="secondary" variant="ghost" onClick={props.onClose} disabled={saving()}>
              Cancel
            </Button>
            <Button
              intent="primary"
              variant="clip1"
              type="submit"
              disabled={saving()}
              data-testid="transactions-form-submit"
            >
              {saving() ? "Saving..." : "Create Transaction"}
            </Button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}

function DetailModal(props: { txn: Detail; onClose: () => void; onVoid: () => void }) {
  const t = props.txn;
  return (
    <ModalShell onClose={props.onClose} wide>
      <div data-testid="transactions-detail-modal">
        <ModalHeader
          title={t.description}
          onClose={props.onClose}
          actions={
            <Show when={t.status !== "voided"}>
              <button
                type="button"
                data-testid="transactions-void-btn"
                onClick={props.onVoid}
                class="text-zinc-500 hover:text-red-400 cursor-pointer p-1"
                title="Void"
                aria-label="Void"
              >
                <Trash2 size={16} />
              </button>
            </Show>
          }
        />
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <DetailRow label="Category" value={CATEGORY_LABELS[t.category] || t.category} />
            <DetailRow label="Subcategory" value={t.subcategory} />
            <DetailRow label="Amount" value={peso(t.amount)} />
            <DetailRow label="Date" value={t.transaction_date} />
            <DetailRow label="Status" value={t.status} />
            <DetailRow label="Reference" value={t.reference_number} />
            <Show when={t.client_name}>
              <DetailRow label="Client" value={t.client_name} />
            </Show>
            <Show when={t.payment_status}>
              <DetailRow label="Payment" value={t.payment_status} />
            </Show>
          </div>
          <Show when={t.notes}>
            <DetailRow label="Notes" value={t.notes} />
          </Show>

          <Show when={t.line_items && t.line_items.length > 0}>
            <div>
              <span class="text-xs text-zinc-500 block mb-2">Line items</span>
              <div class="rounded-lg border border-zinc-800 overflow-hidden">
                <table class="w-full text-xs">
                  <tbody>
                    <For each={t.line_items}>
                      {(li) => (
                        <tr class="border-b border-zinc-800/50 last:border-0">
                          <td class="px-3 py-2 text-zinc-300">
                            {li.quantity}× {li.package_name || li.description}
                            <Show when={li.variant_name}>
                              <span class="text-zinc-500"> · {li.variant_name}</span>
                            </Show>
                            <Show when={li.client_name}>
                              <span class="text-zinc-500"> · {li.client_name}</span>
                            </Show>
                          </td>
                          <td class="px-3 py-2 text-right tabular-nums text-zinc-300">{peso(li.unit_price)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </div>
          </Show>

          <Show when={t.payments && t.payments.length > 0}>
            <div>
              <span class="text-xs text-zinc-500 block mb-2">Payments</span>
              <div class="space-y-1">
                <For each={t.payments}>
                  {(p) => (
                    <div class="flex justify-between text-xs text-zinc-400">
                      <span>Account #{p.financial_account_id}</span>
                      <span class="tabular-nums">{peso(p.amount)}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={t.edits && t.edits.length > 0}>
            <div>
              <span class="text-xs text-zinc-500 block mb-2">History</span>
              <div class="space-y-1">
                <For each={t.edits}>
                  {(e) => (
                    <div class="text-xs text-zinc-500">
                      <span class="uppercase text-zinc-400">{e.kind}</span> — {e.reason}
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </ModalShell>
  );
}

function DetailRow(props: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span class="text-xs text-zinc-500 block">{props.label}</span>
      <span class="text-sm text-zinc-200">{props.value || "—"}</span>
    </div>
  );
}

function SubcategoryModal(props: { onClose: () => void }) {
  const [side, setSide] = createSignal<"income" | "expense">("expense");
  const [newName, setNewName] = createSignal("");
  const [error, setError] = createSignal("");

  const [list, { refetch }] = createResource(side, async (at) => {
    const res = await fetch(`/api/transactions/subcategories?applies_to=${at}`, { credentials: "include" });
    if (!res.ok) return [] as Subcategory[];
    return ((await res.json()) as { subcategories: Subcategory[] }).subcategories;
  });

  async function add() {
    if (!newName().trim()) return;
    setError("");
    const res = await fetch("/api/transactions/subcategories", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName().trim(), applies_to: side() }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}) as { error?: string });
      setError(e.error || "Failed to add");
      return;
    }
    setNewName("");
    refetch();
  }

  async function remove(id: number) {
    await fetch(`/api/transactions/subcategories/${id}`, { method: "DELETE", credentials: "include" });
    refetch();
  }

  return (
    <ModalShell onClose={props.onClose}>
      <div data-testid="transactions-subcat-modal">
        <ModalHeader title="Manage Categories" onClose={props.onClose} />
        <div class="mb-4 flex rounded-lg border border-zinc-800/50 overflow-hidden w-fit">
          <For each={["expense", "income"]}>
            {(s) => (
              <button
                type="button"
                onClick={() => setSide(s as "income" | "expense")}
                class="px-3 py-1.5 text-xs capitalize cursor-pointer"
                classList={{
                  "bg-amber-500/20 text-amber-400": side() === s,
                  "text-zinc-400 hover:text-zinc-200": side() !== s,
                }}
              >
                {s}
              </button>
            )}
          </For>
        </div>

        <Show when={error()}>
          <div class="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error()}
          </div>
        </Show>

        <div class="space-y-1 mb-4">
          <For each={list() ?? []}>
            {(s) => (
              <div class="flex items-center justify-between rounded border border-zinc-800/50 px-3 py-2 text-sm text-zinc-200">
                <span>{s.name}</span>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  class="text-zinc-500 hover:text-red-400 cursor-pointer"
                  aria-label={`Remove ${s.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </For>
        </div>

        <form
          class="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            type="text"
            data-testid="transactions-subcat-name"
            value={newName()}
            onInput={(e) => setNewName(e.currentTarget.value)}
            class={inputClass}
            placeholder={`New ${side()} category`}
          />
          <Button intent="primary" variant="clip1" type="submit" data-testid="transactions-subcat-add">
            Add
          </Button>
        </form>
      </div>
    </ModalShell>
  );
}
