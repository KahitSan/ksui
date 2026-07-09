// Tabbed right rail for the Analytics page: Accounts (live balances, capital
// accounts shown as outstanding/overpaid) and Payables (upcoming/overdue, next 6).
import { createMemo, createSignal, For, Show } from "solid-js";
import { AccountAvatar } from "@kahitsan/ksui";
import { formatCurrency } from "./lib/format";
import type { FinancialAccount, UpcomingPayable } from "./analytics-shared";

export default function AnalyticsRightRail(props: {
  accounts: FinancialAccount[];
  upcoming: UpcomingPayable[];
}) {
  const [tab, setTab] = createSignal<"accounts" | "payables">("accounts");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const enrichedUpcoming = createMemo(() =>
    props.upcoming
      .filter((t) => t.status !== "voided")
      .map((t) => {
        const dateStr = (t.due_date || t.transaction_date)
          .toString()
          .split("T")[0];
        const due = new Date(dateStr + "T00:00:00");
        const daysOut = Math.round(
          (due.getTime() - today.getTime()) / 86400000
        );
        return { ...t, _due: due, _daysOut: daysOut };
      })
      .filter((t) => t._daysOut >= -7)
      .sort((a, b) => a._due.getTime() - b._due.getTime())
  );

  const overdueCount = () =>
    enrichedUpcoming().filter((t) => t._daysOut < 0).length;
  const upcomingTotal = () =>
    enrichedUpcoming()
      .filter((t) => t._daysOut >= 0)
      .reduce((s, t) => s + parseFloat(t.amount), 0);

  const liveAccts = () =>
    props.accounts.filter((a) => parseFloat(String(a.balance ?? 0)) !== 0);

  return (
    <div class="rounded-lg border border-ks-border/50 bg-ks-surface/50 p-5 ks-hud-clip-top-left-bottom-right flex flex-col">
      <div class="flex items-center justify-between mb-4 border-b border-ks-border/60 -mx-5 px-5 pb-3">
        <div class="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab("accounts")}
            class="px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] font-bold border-b-2 -mb-3 flex items-center gap-2 transition-colors cursor-pointer"
            classList={{
              "text-ks-accent border-ks-accent": tab() === "accounts",
              "text-ks-fg-muted border-transparent hover:text-ks-fg":
                tab() !== "accounts",
            }}
          >
            Accounts
            <span class="text-[9px] tracking-widest text-ks-fg-subtle normal-case font-medium">
              {liveAccts().length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab("payables")}
            class="px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] font-bold border-b-2 -mb-3 flex items-center gap-2 transition-colors cursor-pointer"
            classList={{
              "text-ks-accent border-ks-accent": tab() === "payables",
              "text-ks-fg-muted border-transparent hover:text-ks-fg":
                tab() !== "payables",
            }}
          >
            Payables
            <span class="text-[9px] tracking-widest normal-case font-medium">
              <Show
                when={overdueCount() > 0}
                fallback={
                  <span class="text-ks-fg-subtle">{enrichedUpcoming().length}</span>
                }
              >
                <span class="text-ks-danger">{overdueCount()} late</span>
              </Show>
            </span>
          </button>
        </div>
        <Show when={tab() === "payables" && upcomingTotal() > 0}>
          <div class="text-right">
            <div class="text-xs font-bold tabular-nums text-ks-accent">
              {formatCurrency(upcomingTotal())}
            </div>
            <div class="text-[9px] uppercase tracking-widest text-ks-fg-subtle">
              due soon
            </div>
          </div>
        </Show>
      </div>

      <Show when={tab() === "accounts"}>
        <div class="space-y-2">
          <Show
            when={liveAccts().length > 0}
            fallback={
              <div class="text-xs text-ks-fg-muted py-6 text-center">
                No accounts with balances yet.
              </div>
            }
          >
            <For each={liveAccts()}>
              {(a) => {
                const balance = parseFloat(String(a.balance ?? 0));
                const isCapital = a.type === "capital";
                const capitalOutstanding = isCapital
                  ? -Math.min(balance, 0)
                  : 0;
                const capitalOverpaid = isCapital && balance > 0;
                const negative = !isCapital && balance < 0;
                let capitalLabel: string;
                if (capitalOverpaid) capitalLabel = "overpaid";
                else if (capitalOutstanding === 0) capitalLabel = "settled";
                else capitalLabel = "to return";
                return (
                  <div class="flex items-center gap-3 p-2 -mx-2 hover:bg-ks-surface-raised/30 transition-colors">
                    <AccountAvatar account={a} size={32} />
                    <div class="min-w-0 flex-1">
                      <div class="text-xs text-ks-fg font-medium truncate">
                        {a.name}
                      </div>
                      <div class="text-[10px] text-ks-fg-subtle uppercase tracking-widest">
                        {a.type.replace("_", " ")}
                      </div>
                    </div>
                    <Show
                      when={!isCapital}
                      fallback={
                        <div class="text-right shrink-0">
                          <div
                            class="text-sm font-bold tabular-nums"
                            classList={{
                              "text-ks-danger": capitalOverpaid,
                              "text-ks-accent": !capitalOverpaid,
                            }}
                          >
                            {capitalOverpaid
                              ? `+${formatCurrency(balance)}`
                              : formatCurrency(capitalOutstanding)}
                          </div>
                          <div
                            class="text-[10px] uppercase tracking-wider"
                            classList={{
                              "text-ks-danger/70": capitalOverpaid,
                              "text-ks-fg-muted": !capitalOverpaid,
                            }}
                          >
                            {capitalLabel}
                          </div>
                        </div>
                      }
                    >
                      <div
                        class="text-sm font-bold tabular-nums shrink-0"
                        classList={{
                          "text-ks-danger": negative,
                          "text-ks-fg": !negative,
                        }}
                      >
                        {formatCurrency(balance)}
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </Show>

      <Show when={tab() === "payables"}>
        <div class="space-y-1.5">
          <Show
            when={enrichedUpcoming().length > 0}
            fallback={
              <div class="text-xs text-ks-fg-muted py-6 text-center">
                Nothing due soon.
              </div>
            }
          >
            <For each={enrichedUpcoming().slice(0, 6)}>
              {(t) => {
                const overdue = t._daysOut < 0;
                const dueSoon = t._daysOut >= 0 && t._daysOut <= 3;
                return (
                  <div class="flex items-center gap-3 p-2 -mx-2 hover:bg-ks-surface-raised/30 transition-colors">
                    <div
                      class="w-9 text-center shrink-0 border-r pr-2 -my-1 py-1"
                      classList={{
                        "border-ks-danger/30": overdue,
                        "border-ks-accent/30": dueSoon,
                        "border-ks-border": !overdue && !dueSoon,
                      }}
                    >
                      <div
                        class="text-[10px] uppercase tracking-widest font-bold"
                        classList={{
                          "text-ks-danger": overdue,
                          "text-ks-accent": dueSoon,
                          "text-ks-fg-muted": !overdue && !dueSoon,
                        }}
                      >
                        {t._due.toLocaleDateString("en-US", { month: "short" })}
                      </div>
                      <div
                        class="text-sm font-bold tabular-nums leading-none"
                        classList={{
                          "text-ks-danger": overdue,
                          "text-ks-accent-hover": dueSoon,
                          "text-ks-fg": !overdue && !dueSoon,
                        }}
                      >
                        {t._due.getDate()}
                      </div>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="text-xs text-ks-fg font-medium truncate">
                        {t.description}
                      </div>
                      <div class="text-[10px] text-ks-fg-subtle truncate flex items-center gap-1.5">
                        <span class="truncate">{t.payee || "—"}</span>
                        <Show when={overdue}>
                          <span class="text-ks-danger font-semibold uppercase tracking-widest shrink-0">
                            · {Math.abs(t._daysOut)}d late
                          </span>
                        </Show>
                        <Show when={dueSoon}>
                          <span class="text-ks-accent font-semibold uppercase tracking-widest shrink-0">
                            · in {t._daysOut}d
                          </span>
                        </Show>
                      </div>
                    </div>
                    <div class="text-sm font-bold tabular-nums text-ks-fg shrink-0">
                      {formatCurrency(t.amount)}
                    </div>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}
