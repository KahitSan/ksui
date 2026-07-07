// §9 interaction graph for the folded-in Analytics page — the dashboard's flows
// as node steps, served at /__meta/flows for the kernel to render. Spread into the
// plugin's `flows` array by ./flows.ts. Edit by hand; ExecFlow nodes execute via
// runFlow in the UI (AnalyticsPage's Retry).
import { buildFlow, type FlowDefinition } from "@kahitsan/plugin-sdk/flow";
// retryFlow lives in the UI-neutral shared module so the browser page can dispatch
// it without a ui→server import; the server only re-exports it into the graph here.
import { retryFlow } from "../ui/remote/analytics-shared.js";

export const analyticsFlows: FlowDefinition[] = [
  buildFlow("analytics.board", "Open Analytics Dashboard", (f) => {
    const n_open = f.trigger("Open Analytics page");
    const n_gate = f.condition("Can view analytics?");
    const n_locked = f.terminal("Access locked");
    const n_fanout = f.compute("Mount: fire all loads");
    const n_load_summary = f.load(
      "Load totals + cashflow",
      "Promise.all GET /api/transactions/summary + /api/transactions/cashflow (month preset)"
    );
    const n_check_summary = f.condition("Summary/cashflow OK?");
    const n_load_payables = f.load(
      "Load upcoming payables",
      "GET /api/transactions?category=payable (last 7d..next 60d, sort transaction_date ASC)"
    );
    const n_check_payables = f.condition("Payables OK?");
    const n_load_accounts = f.load(
      "Load financial accounts",
      "GET /api/financial-accounts?limit=200&status=active"
    );
    const n_check_accounts = f.condition("Accounts OK?");
    const n_kpis = f.compute("Compute KPIs + sparklines");
    const n_render = f.data(
      "KPI cards, cashflow chart, right rail",
      "5 KpiCards + CashflowChart + RightRailCard"
    );
    const n_private_hidden = f.condition("Private txns hidden?");
    const n_private_note = f.effect(
      "Show 'private hidden may affect totals' note"
    );
    const n_error_banner = f.effect("Show error banner with Retry");
    const n_done = f.terminal("Dashboard ready");
    n_open.to(n_gate);
    n_gate.to(n_fanout, "yes");
    n_gate.to(n_locked, "no");
    n_fanout.to(n_load_summary, "totals");
    n_fanout.to(n_load_payables, "payables");
    n_load_summary.to(n_check_summary);
    n_check_summary.to(n_kpis, "yes");
    n_check_summary.to(n_error_banner, "no");
    n_load_payables.to(n_check_payables);
    n_check_payables.to(n_load_accounts, "yes");
    n_check_payables.to(n_error_banner, "no");
    n_load_accounts.to(n_check_accounts);
    n_check_accounts.to(n_kpis, "yes");
    n_check_accounts.to(n_error_banner, "no");
    n_kpis.to(n_render);
    n_render.to(n_private_hidden);
    n_private_hidden.to(n_private_note, "yes");
    n_private_hidden.to(n_done, "no");
    n_private_note.to(n_done);
    n_error_banner.to(n_done);
  }),
  buildFlow("analytics.filter", "Change Date Range", (f) => {
    const n_preset_click = f.trigger("Click Today/Week/Month/Year/Custom");
    const n_set_preset = f.compute("Set preset");
    const n_is_custom = f.condition("Custom preset?");
    const n_custom_pickers = f.modal("Show inline From/To pickers");
    const n_apply_click = f.trigger("Click Apply (custom)");
    const n_resolve_range = f.compute("Resolve from/to range");
    const n_refetch = f.load(
      "Re-load totals + cashflow",
      "fetchSummary reacts to effectiveDateRange: GET /api/transactions/summary + /cashflow?dateFrom&dateTo"
    );
    const n_check = f.condition("Loaded OK?");
    const n_refresh = f.effect("Refresh KPI cards + chart");
    const n_err = f.effect("Show error banner");
    const n_done = f.terminal("Range applied");
    n_preset_click.to(n_set_preset);
    n_set_preset.to(n_is_custom);
    n_is_custom.to(n_custom_pickers, "yes");
    n_is_custom.to(n_resolve_range, "no");
    n_custom_pickers.to(n_resolve_range);
    n_apply_click.to(n_resolve_range);
    n_resolve_range.to(n_refetch);
    n_refetch.to(n_check);
    n_check.to(n_refresh, "yes");
    n_check.to(n_err, "no");
    n_refresh.to(n_done);
    n_err.to(n_done);
  }),
  buildFlow(
    "analytics.rightrail",
    "Right Rail Tabs (Accounts / Payables)",
    (f) => {
      const n_rail_data = f.data(
        "Accounts + payables loaded",
        "liveAccts (balance != 0); enrichedUpcoming (not voided, _daysOut >= -7, sorted by due)"
      );
      const n_tab_accounts = f.trigger("Click Accounts tab");
      const n_show_accounts = f.effect("Show account balances");
      const n_tab_payables = f.trigger("Click Payables tab");
      const n_show_payables = f.effect("Show upcoming/overdue payables");
      n_rail_data.to(n_tab_accounts, "accounts tab");
      n_rail_data.to(n_tab_payables, "payables tab");
      n_tab_accounts.to(n_show_accounts);
      n_show_accounts.to(n_rail_data);
      n_tab_payables.to(n_show_payables);
      n_show_payables.to(n_rail_data);
    }
  ),
  buildFlow("analytics.retry", "Retry / Dismiss Error Banner", (f) => {
    const n_banner = f.data("Error banner shown");
    const n_retry_click = f.trigger("Click Retry");
    const n_clear_err = f.effect("Clear error");
    const n_refetch_all = f.load(
      "Re-run all fetches",
      "fetchSummary + fetchUpcomingPayables + fetchAccounts"
    );
    const n_dismiss_click = f.trigger("Click Dismiss (X)");
    const n_hide = f.effect("Hide banner");
    const n_done = f.terminal("Resolved");
    n_banner.to(n_retry_click, "retry");
    n_banner.to(n_dismiss_click, "dismiss");
    n_retry_click.to(n_clear_err);
    n_clear_err.to(n_refetch_all);
    n_refetch_all.to(n_done);
    n_dismiss_click.to(n_hide);
    n_hide.to(n_done);
  }),
  retryFlow, // the executable §9 flow above — renders here, runs in the UI
  buildFlow("analytics.share", "Share Analytics Page", (f) => {
    const n_share_click = f.trigger("Click Share button");
    const n_share_modal = f.modal("Open share dialog");
    const n_shared = f.terminal("Share link generated");
    n_share_click.to(n_share_modal);
    n_share_modal.to(n_shared);
  }),
  buildFlow("analytics.workspace_switch", "Workspace Switch Refetch", (f) => {
    const n_ws_switch = f.trigger("Switch active workspace");
    const n_reset = f.effect("Reset error banner");
    const n_refetch_all = f.load(
      "Re-run all fetches for new workspace",
      "fetchSummary + fetchUpcomingPayables + fetchAccounts; stale gen-guard drops in-flight responses from prior workspace"
    );
    const n_guard = f.condition("Still on same workspace?");
    const n_apply = f.effect("Apply data to KPIs/rail");
    const n_drop = f.terminal("Stale response dropped");
    const n_done = f.terminal("Dashboard refreshed");
    n_ws_switch.to(n_reset);
    n_reset.to(n_refetch_all);
    n_refetch_all.to(n_guard);
    n_guard.to(n_apply, "yes");
    n_guard.to(n_drop, "no");
    n_apply.to(n_done);
  }),
];
