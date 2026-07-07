// Finance Analytics page — folded IN from the retired standalone analytics plugin.
// Rendered by this bundle's dispatching Component when the host route is
// `/analytics`. Read-only dashboard: it aggregates data the user already has
// access to via routes that live in THIS plugin now (/api/transactions/summary,
// /cashflow, /api/transactions) plus a cross-plugin browser fetch to
// /api/financial-accounts (a separate plugin the kernel reverse-proxies). Gated on
// this plugin's own `analytics.view` permission — separate from transactions.view.
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import Lock from "lucide-solid/icons/lock";
import Activity from "lucide-solid/icons/activity";
import ArrowDownLeft from "lucide-solid/icons/arrow-down-left";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import ArrowRightLeft from "lucide-solid/icons/arrow-right-left";
import CalendarDays from "lucide-solid/icons/calendar-days";
import AlertTriangle from "lucide-solid/icons/alert-triangle";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import X from "lucide-solid/icons/x";
import { KpiCard, DatePicker, SegmentedFilter } from "@kahitsan/ksui";
import {
  PageShell,
  PageShareButton,
  useActiveWorkspace,
  usePermissions,
  PermissionGate,
} from "@kserp/host-ui";
import { runFlow } from "@kahitsan/plugin-sdk/flow";
import { formatCurrency } from "./lib/format";
import AnalyticsCashflowChart from "./AnalyticsCashflowChart";
import AnalyticsRightRail from "./AnalyticsRightRail";
import {
  manilaToday,
  retryFlow,
  ymd,
  type CashflowBucket,
  type FinancialAccount,
  type UpcomingPayable,
} from "./analytics-shared";

export default function AnalyticsPage() {
  const { activeWorkspace } = useActiveWorkspace();
  const perms = usePermissions();
  const canAccess = () => perms.has("analytics.view");

  type DatePreset = "today" | "week" | "month" | "year" | "custom";
  const [statsPreset, setStatsPreset] = createSignal<DatePreset>("month");
  const [statsDateFrom, setStatsDateFrom] = createSignal("");
  const [statsDateTo, setStatsDateTo] = createSignal("");
  const [statsSummary, setStatsSummary] = createSignal<{
    expense: { count: number; total: number };
    sale: { count: number; total: number };
    business: { count: number; total: number };
    payable: { count: number; total: number };
    _privateHidden?: number;
  }>({
    expense: { count: 0, total: 0 },
    sale: { count: 0, total: 0 },
    business: { count: 0, total: 0 },
    payable: { count: 0, total: 0 },
    _privateHidden: 0,
  });
  const [cashflowBuckets, setCashflowBuckets] = createSignal<CashflowBucket[]>(
    []
  );
  const [upcomingPayables, setUpcomingPayables] = createSignal<
    UpcomingPayable[]
  >([]);
  const [accounts, setAccounts] = createSignal<FinancialAccount[]>([]);
  // A single generic banner rather than a per-endpoint message: multiple fetches
  // can fail in one cycle and a "last error wins" string would hide the others.
  // The console still gets a per-endpoint log; Retry re-runs every fetch.
  const ANALYTICS_ERROR_MESSAGE = "Some analytics didn't load -- click Retry.";
  const [analyticsError, setAnalyticsError] = createSignal<string | null>(null);

  function getPresetRange(preset: DatePreset): { from: string; to: string } {
    // Anchor on Manila's civil date (Timezone discipline) — a bare toISOString()
    // would report yesterday during PHT early-morning and show the wrong window.
    const today = manilaToday();
    const to = ymd(today);
    if (preset === "today") return { from: to, to };
    if (preset === "week") {
      const start = new Date(today);
      start.setDate(today.getDate() - today.getDay());
      return { from: ymd(start), to };
    }
    if (preset === "month") {
      return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to };
    }
    if (preset === "year") {
      return { from: `${today.getFullYear()}-01-01`, to };
    }
    return { from: statsDateFrom(), to: statsDateTo() };
  }

  const effectiveDateRange = createMemo(() => getPresetRange(statsPreset()));

  /**
   * Both arms carry the stale-workspace guard: the gen captured at call time is
   * compared to the current workspace before any state write, so a mid-flight
   * workspace switch drops the response. Split out only to cap fetchSummary's
   * complexity; the guard placement (none before the summary !ok setError since no
   * await precedes it; one before the cashflow !ok setError since the summary json
   * await may have yielded) is preserved exactly.
   */
  async function applySummaryResult(sumRes: Response, gen: unknown) {
    if (!sumRes.ok) {
      console.error("[analytics] fetchSummary (summary) failed", sumRes.status);
      setAnalyticsError(ANALYTICS_ERROR_MESSAGE);
      return;
    }
    const data = await sumRes.json();
    if (activeWorkspace()?.ws_id !== gen) return;
    if (!data.payable) data.payable = { count: 0, total: 0 };
    setStatsSummary(data);
  }

  async function applyCashflowResult(flowRes: Response, gen: unknown) {
    if (!flowRes.ok) {
      console.error(
        "[analytics] fetchSummary (cashflow) failed",
        flowRes.status
      );
      if (activeWorkspace()?.ws_id !== gen) return;
      setAnalyticsError(ANALYTICS_ERROR_MESSAGE);
      return;
    }
    const data = await flowRes.json();
    if (activeWorkspace()?.ws_id !== gen) return;
    setCashflowBuckets(data.buckets || []);
  }

  async function fetchSummary() {
    const { from, to } = effectiveDateRange();
    if (!from && !to) return;
    // Capture the workspace id at call time; a mid-flight switch drops the
    // response so a stale failure can't flash a banner on the new-workspace page
    // (and stale data can't bleed across workspaces).
    const gen = activeWorkspace()?.ws_id;
    try {
      const q = new URLSearchParams();
      if (from) q.set("dateFrom", from);
      if (to) q.set("dateTo", to);
      const [sumRes, flowRes] = await Promise.all([
        fetch(`/api/transactions/summary?${q}`),
        fetch(`/api/transactions/cashflow?${q}`),
      ]);
      if (activeWorkspace()?.ws_id !== gen) return;
      await applySummaryResult(sumRes, gen);
      await applyCashflowResult(flowRes, gen);
    } catch (err) {
      console.error("[analytics] fetchSummary failed", err);
      if (activeWorkspace()?.ws_id !== gen) return;
      setAnalyticsError(ANALYTICS_ERROR_MESSAGE);
    }
  }

  async function fetchUpcomingPayables() {
    const gen = activeWorkspace()?.ws_id;
    try {
      // Manila-anchored window (Timezone discipline): the ±7/±60-day payables
      // range is computed from Manila's civil date, not a UTC-shifted toISOString.
      const today = manilaToday();
      const past = new Date(today);
      past.setDate(today.getDate() - 7);
      const future = new Date(today);
      future.setDate(today.getDate() + 60);
      const q = new URLSearchParams({
        category: "payable",
        dateFrom: ymd(past),
        dateTo: ymd(future),
        limit: "50",
        sortBy: "transaction_date",
        sortDir: "ASC",
      });
      const res = await fetch(`/api/transactions?${q}`);
      if (activeWorkspace()?.ws_id !== gen) return;
      if (!res.ok) {
        console.error("[analytics] fetchUpcomingPayables failed", res.status);
        setAnalyticsError(ANALYTICS_ERROR_MESSAGE);
        return;
      }
      const data = await res.json();
      if (activeWorkspace()?.ws_id !== gen) return;
      setUpcomingPayables(data.data || []);
    } catch (err) {
      console.error("[analytics] fetchUpcomingPayables failed", err);
      if (activeWorkspace()?.ws_id !== gen) return;
      setAnalyticsError(ANALYTICS_ERROR_MESSAGE);
    }
  }

  async function fetchAccounts() {
    const gen = activeWorkspace()?.ws_id;
    try {
      const res = await fetch(
        "/api/financial-accounts?limit=200&status=active"
      );
      if (activeWorkspace()?.ws_id !== gen) return;
      if (!res.ok) {
        console.error("[analytics] fetchAccounts failed", res.status);
        setAnalyticsError(ANALYTICS_ERROR_MESSAGE);
        return;
      }
      const data = await res.json();
      if (activeWorkspace()?.ws_id !== gen) return;
      setAccounts(data.data || []);
    } catch (err) {
      console.error("[analytics] fetchAccounts failed", err);
      if (activeWorkspace()?.ws_id !== gen) return;
      setAnalyticsError(ANALYTICS_ERROR_MESSAGE);
    }
  }

  function retryAllFetches() {
    // §9 EXECUTION: the declared retryFlow IS this behaviour — runFlow walks
    // retry → clear/re-run effect, the exact analytics.retry graph the Connections
    // tab renders. The refresh seam clears the banner and re-runs the three
    // gen-guarded loaders (the guard can't live in a FlowContext).
    void runFlow(retryFlow, "retry", {
      state: {},
      fetch: (url: string, init?: RequestInit) =>
        fetch(url, { ...init, credentials: "include" }),
      ui: {
        refresh: () => {
          setAnalyticsError(null);
          fetchSummary();
          fetchUpcomingPayables();
          fetchAccounts();
        },
      },
    });
  }

  // Re-fetch on workspace switch. Reading activeWorkspace() inside each effect
  // registers the workspace signal as a dependency so the effect re-runs on
  // switch; resetting the banner before each refetch mirrors retryAllFetches.
  createEffect(() => {
    activeWorkspace();
    setAnalyticsError(null);
    fetchSummary();
  });

  createEffect(() => {
    activeWorkspace();
    setAnalyticsError(null);
    fetchUpcomingPayables();
  });

  createEffect(() => {
    activeWorkspace();
    setAnalyticsError(null);
    fetchAccounts();
  });

  function changePreset(p: DatePreset) {
    setStatsPreset(p);
  }

  function applyCustomRange() {
    setStatsPreset("custom");
  }

  const sumExpense = () => statsSummary().expense?.total || 0;
  const sumSale = () => statsSummary().sale?.total || 0;
  const sumBusiness = () => statsSummary().business?.total || 0;
  const sumPayable = () => statsSummary().payable?.total || 0;
  const netCashflow = () => sumSale() - sumExpense() - sumPayable();
  const revSpark = createMemo(() => cashflowBuckets().map((b) => b.in));
  const expSpark = createMemo(() => cashflowBuckets().map((b) => b.out));
  const netSpark = createMemo(() => cashflowBuckets().map((b) => b.in - b.out));

  return (
    <PermissionGate when={canAccess()}>
      <PageShell
        title="Finance Analytics"
        subtitle="Every peso moving through your workspace -- sales, expenses, payables and transfers in one ledger."
        actions={
          <>
            <SegmentedFilter
              options={[
                { value: "today", label: "Today" },
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
                { value: "year", label: "Year" },
                { value: "custom", label: "Custom" },
              ]}
              value={statsPreset()}
              onChange={(v) => changePreset(v as DatePreset)}
              testIdPrefix="analytics-preset"
              class="min-h-[36px]"
            />
            <PageShareButton module="analytics" moduleLabel="Analytics" />
          </>
        }
      >
        <div class="min-w-0 overflow-hidden">
          <Show when={statsPreset() === "custom"}>
            <div class="flex items-center gap-2 mb-4 flex-wrap">
              <DatePicker
                value={statsDateFrom()}
                onChange={(d: string | null) => d && setStatsDateFrom(d)}
              />
              <span class="text-zinc-600 text-xs">to</span>
              <DatePicker
                value={statsDateTo()}
                onChange={(d: string | null) => d && setStatsDateTo(d)}
              />
              <button
                onClick={applyCustomRange}
                class="px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/20 active:bg-amber-500/30 rounded-lg border border-amber-500/30 cursor-pointer min-h-[36px]"
              >
                Apply
              </button>
            </div>
          </Show>

          <Show when={analyticsError()}>
            <div
              class="mb-3 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              data-testid="analytics-error-banner"
              role="alert"
            >
              <AlertTriangle size={16} class="text-red-400 shrink-0 mt-0.5" />
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-red-200">
                  Some analytics didn't load
                </div>
                <div class="text-xs text-red-300/90 mt-0.5">
                  Click Retry to try again, or dismiss this notice.
                </div>
              </div>
              <button
                type="button"
                onClick={retryAllFetches}
                data-testid="analytics-error-retry"
                class="ks-interactive flex items-center gap-1.5 rounded border border-red-400/40 bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/25 active:bg-red-500/35 cursor-pointer min-h-[28px]"
              >
                <RefreshCw size={12} />
                Retry
              </button>
              <button
                type="button"
                onClick={() => setAnalyticsError(null)}
                data-testid="analytics-error-dismiss"
                aria-label="Dismiss"
                class="ks-interactive flex items-center justify-center rounded p-1 text-red-300/70 hover:text-red-200 hover:bg-red-500/15 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          </Show>

          <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
            <KpiCard
              label="Net cash flow"
              value={
                (netCashflow() >= 0 ? "+" : "-") +
                formatCurrency(Math.abs(netCashflow()))
              }
              tone={netCashflow() >= 0 ? "success" : "danger"}
              icon={Activity}
              sparkline={netSpark()}
              clipClass="ks-hud-clip-top-left-bottom-right"
            />
            <KpiCard
              label="Revenue"
              value={formatCurrency(sumSale())}
              hint={`${statsSummary().sale?.count || 0} sales`}
              tone="success"
              icon={ArrowDownLeft}
              sparkline={revSpark()}
              clipClass="ks-hud-clip-top-left-bottom-right"
            />
            <KpiCard
              label="Expenses"
              value={formatCurrency(sumExpense())}
              hint={`${statsSummary().expense?.count || 0} entries`}
              tone="danger"
              icon={ArrowUpRight}
              sparkline={expSpark()}
              clipClass="ks-hud-clip-top-left-bottom-right"
            />
            <KpiCard
              label="Payables"
              value={formatCurrency(sumPayable())}
              hint={`${statsSummary().payable?.count || 0} due`}
              tone="warning"
              icon={CalendarDays}
              clipClass="ks-hud-clip-top-left-bottom-right"
            />
            <KpiCard
              label="Transfers"
              value={formatCurrency(sumBusiness())}
              hint={`${statsSummary().business?.count || 0} moves`}
              tone="info"
              icon={ArrowRightLeft}
              clipClass="ks-hud-clip-top-left-bottom-right"
            />
          </div>

          <Show when={(statsSummary()._privateHidden || 0) > 0}>
            <div class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 mb-3 flex items-center gap-2 text-xs text-zinc-400">
              <Lock size={12} class="text-amber-500/60 shrink-0" />
              <span>
                <span class="text-amber-400 font-semibold">
                  {statsSummary()._privateHidden}
                </span>{" "}
                private transaction(s) hidden -- may affect totals.
              </span>
            </div>
          </Show>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6">
            <div class="lg:col-span-2">
              <AnalyticsCashflowChart buckets={cashflowBuckets()} />
            </div>
            <AnalyticsRightRail
              accounts={accounts() as FinancialAccount[]}
              upcoming={upcomingPayables()}
            />
          </div>
        </div>
      </PageShell>
    </PermissionGate>
  );
}
