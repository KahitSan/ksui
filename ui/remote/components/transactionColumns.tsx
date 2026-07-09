// DataTable column definitions for the transactions list.
// Extracted verbatim from index.tsx — the per-cell render functions for the
// Date / TX# / Description / Category / Payee / Accounts / By / Amount / chevron
// columns. The cell renders read host-runtime accessors (expandedGroups,
// tableSearchTerm, peersUnavailable, accountsIndex) and the creatorName
// resolver, so they're threaded through a `deps` object of accessors rather
// than closed over Component() — Solid's call-site reactive tracking is
// preserved because each accessor is still invoked inside the render body.

import { Show } from "solid-js";
import { formatCurrency, formatDate } from "../lib/format";
import { CATEGORY_TONE, TONE_CLASSES } from "../lib/constants";
import { type TransactionRow } from "../lib/rows";
import { PeerUnavailable, SharedWithStack } from "./RowMarkers";
import Lock from "lucide-solid/icons/lock";
import Paperclip from "lucide-solid/icons/paperclip";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ArrowDownLeft from "lucide-solid/icons/arrow-down-left";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import ArrowRight from "lucide-solid/icons/arrow-right";
import ChevronRight from "lucide-solid/icons/chevron-right";
import {
  Avatar,
  MarkdownNotes,
  AccountAvatar,
  resolveAccount,
  highlightMatch,
  type DataTableColumn,
} from "@kahitsan/ksui";

export interface TransactionColumnDeps {
  expandedGroups: () => Set<string>;
  tableSearchTerm: () => string;
  peersUnavailable: () => { accounts: boolean; payees: boolean };
  accountsIndex: () => Parameters<typeof resolveAccount>[0];
  creatorName: (userId: string | null | undefined) => string | null;
}

export function makeTransactionColumns(
  deps: TransactionColumnDeps
): DataTableColumn<TransactionRow>[] {
  const {
    expandedGroups,
    tableSearchTerm,
    peersUnavailable,
    accountsIndex,
    creatorName,
  } = deps;
  return [
    {
      data: "transaction_date",
      title: "Date",
      orderable: true,
      className: "w-[90px]",
      render: (_val, _type, row) => {
        if (row._grouped) {
          const isOpen = expandedGroups().has(row._groupKey || "");
          return (
            <span
              class="flex items-center gap-1 text-ks-fg text-[11px] tabular-nums whitespace-nowrap font-semibold"
              data-testid="grouped-row-date"
            >
              <Show
                when={isOpen}
                fallback={<ChevronRight size={12} class="text-ks-fg-muted" />}
              >
                <ChevronDown size={12} class="text-ks-accent" />
              </Show>
              {formatDate(row._groupDate || row.transaction_date)}
            </span>
          );
        }
        return (
          <span
            class="text-ks-fg-muted text-[11px] tabular-nums whitespace-nowrap"
            classList={{ "pl-4": !!row._isSubrow }}
          >
            {formatDate(row.transaction_date)}
          </span>
        );
      },
    },
    {
      data: "id",
      title: "TX#",
      className: "w-[60px] text-right",
      render: (_val, _type, row) => (
        <Show
          when={!row._grouped}
          fallback={<span class="text-[11px] text-ks-fg-subtle">—</span>}
        >
          <span class="text-[11px] tabular-nums text-ks-fg-muted">#{row.id}</span>
        </Show>
      ),
    },
    {
      data: "description",
      title: "Description",
      orderable: true,
      render: (_val, _type, row) => {
        if (row._grouped) {
          const count = row._groupCount || 0;
          return (
            <div class="min-w-0 py-1">
              <div class="flex items-center gap-1.5">
                <span
                  class="text-sm font-semibold text-ks-fg truncate"
                  data-testid="grouped-row-summary"
                >
                  {count} {count === 1 ? "sale" : "sales"} on this day
                </span>
              </div>
            </div>
          );
        }
        return (
          <div class="min-w-0 py-1">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-medium text-ks-fg truncate">
                {highlightMatch(row.description ?? "", tableSearchTerm())}
              </span>
              <Show when={row.is_private}>
                <Lock size={12} class="text-ks-accent/60 shrink-0" />
              </Show>
              <Show when={row.is_private && (row.shared_with?.length ?? 0) > 0}>
                <SharedWithStack people={row.shared_with!} />
              </Show>
              <Show when={parseInt(row.attachment_count) > 0}>
                <span class="flex items-center gap-0.5 text-ks-fg-muted shrink-0">
                  <Paperclip size={12} />
                  <span class="text-[10px]">{row.attachment_count}</span>
                </span>
              </Show>
              <Show when={row.cheque_number}>
                <span class="text-[9px] uppercase tracking-widest text-ks-accent/80 border border-ks-accent/30 px-1 py-px shrink-0">
                  PDC
                </span>
              </Show>
            </div>
            <Show when={row.notes}>
              <MarkdownNotes
                value={row.notes}
                class="text-[11px] text-ks-fg-muted leading-snug mt-0.5 line-clamp-1"
              />
            </Show>
          </div>
        );
      },
    },
    {
      data: "subcategory",
      title: "Category",
      className: "hidden lg:table-cell w-[180px]",
      render: (_val, _type, row) => (
        <Show
          when={!row._grouped && row.subcategory}
          fallback={<span class="text-[11px] text-ks-fg-subtle">—</span>}
        >
          <span class="inline-block text-[11px] text-ks-fg-muted truncate">
            {row.subcategory}
          </span>
        </Show>
      ),
    },
    {
      data: "payee",
      title: "Payee",
      className: "hidden md:table-cell w-[160px]",
      render: (_val, _type, row) => {
        if (!row._grouped && row.payee) {
          return (
            <span class="text-xs text-ks-fg truncate">
              {highlightMatch(row.payee ?? "", tableSearchTerm())}
            </span>
          );
        }
        // Has a payee but the name couldn't be loaded because the payees plugin
        // was unavailable for this fetch — show a marker, not a blank.
        if (
          !row._grouped &&
          row.payee_id != null &&
          peersUnavailable().payees
        ) {
          return (
            <PeerUnavailable title="Payees plugin unavailable — couldn't load payee name" />
          );
        }
        return <span class="text-[11px] text-ks-fg-subtle">—</span>;
      },
    },
    {
      data: null,
      title: "Accounts",
      className: "hidden md:table-cell w-[220px]",
      render: (_val, _type, row) => {
        if (row._grouped) {
          return <span class="text-[11px] text-ks-fg-subtle">—</span>;
        }
        // The row references an account but no name resolved because the
        // financial-accounts plugin was unavailable for this fetch — show a
        // marker for the whole cell instead of misleading dashes.
        const hasAccount =
          row.source_account_id != null || row.destination_account_id != null;
        const nameResolved = !!(
          row.source_account_name || row.destination_account_name
        );
        if (hasAccount && !nameResolved && peersUnavailable().accounts) {
          return (
            <PeerUnavailable title="Financial accounts plugin unavailable — couldn't load accounts" />
          );
        }
        const srcAcct = resolveAccount(accountsIndex(), row.source_account_id);
        const dstAcct = resolveAccount(
          accountsIndex(),
          row.destination_account_id
        );
        if (row.category === "business") {
          return (
            <span class="flex items-center gap-1.5 text-xs text-ks-fg-muted truncate">
              <Show when={srcAcct}>
                {(a) => <AccountAvatar account={a()} size={14} />}
              </Show>
              <span class="text-ks-fg-muted truncate">
                {row.source_account_name || "—"}
              </span>
              <ArrowRight size={10} class="text-ks-fg-subtle shrink-0" />
              <Show when={dstAcct}>
                {(a) => <AccountAvatar account={a()} size={14} />}
              </Show>
              <span class="text-ks-fg truncate">
                {row.destination_account_name || "—"}
              </span>
            </span>
          );
        }
        if (row.category === "sale") {
          return (
            <span class="flex items-center gap-1.5 text-xs text-ks-fg-muted truncate">
              <ArrowDownLeft size={10} class="text-ks-success/70 shrink-0" />
              <Show when={dstAcct}>
                {(a) => <AccountAvatar account={a()} size={14} />}
              </Show>
              <span class="text-ks-fg truncate">
                {row.destination_account_name || "—"}
              </span>
            </span>
          );
        }
        return (
          <span class="flex items-center gap-1.5 text-xs text-ks-fg-muted min-w-0">
            <ArrowUpRight
              size={10}
              class={
                row.category === "payable"
                  ? "text-ks-accent/80 shrink-0"
                  : "text-ks-danger/70 shrink-0"
              }
            />
            <Show
              when={dstAcct || row.destination_account_name}
              fallback={
                <Show
                  when={row.source_account_name}
                  fallback={<span class="text-ks-fg truncate">{"—"}</span>}
                >
                  <Show when={srcAcct}>
                    {(a) => <AccountAvatar account={a()} size={14} />}
                  </Show>
                  <span class="text-ks-fg truncate">
                    {row.source_account_name}
                  </span>
                </Show>
              }
            >
              <Show when={dstAcct}>
                {(a) => <AccountAvatar account={a()} size={14} />}
              </Show>
              <span class="text-ks-fg truncate">
                {row.destination_account_name}
              </span>
              <Show when={row.source_account_name}>
                <span class="inline-flex items-center gap-1 text-ks-fg-subtle truncate">
                  <span>·</span>
                  <Show when={srcAcct}>
                    {(a) => <AccountAvatar account={a()} size={14} />}
                  </Show>
                  <span class="truncate">{row.source_account_name}</span>
                </span>
              </Show>
            </Show>
          </span>
        );
      },
    },
    {
      data: null,
      title: "By",
      className: "hidden lg:table-cell w-[60px] text-center",
      render: (_val, _type, row) => {
        if (row._grouped) {
          return <span class="text-[11px] text-ks-fg-subtle">—</span>;
        }
        // created_by is a kernel user id; the server can't join the kernel
        // `user` table, so resolve the display name from the host's workspace member
        // list. Falls back to "Unknown" until members load / for ex-members.
        const name =
          creatorName(row.created_by) || row.created_by_name || "Unknown";
        return (
          <div class="flex justify-center">
            <Avatar name={name} image={row.created_by_image} size="sm" />
          </div>
        );
      },
    },
    {
      data: "amount",
      title: "Amount",
      orderable: true,
      className: "text-right w-[140px]",
      render: (_val, _type, row) => {
        const tone = CATEGORY_TONE[row.category] || CATEGORY_TONE.expense;
        const t = TONE_CLASSES[tone.tone];
        const amt = row._grouped ? String(row._groupTotal ?? 0) : row.amount;
        const isVoided = !row._grouped && row.status === "voided";
        const balanceNum =
          !row._grouped &&
          !isVoided &&
          row.payment_status === "partial" &&
          row.balance != null
            ? parseFloat(row.balance)
            : 0;
        const showBalance = balanceNum > 0;
        return (
          <div class="flex flex-col items-end gap-0.5">
            <span
              class={`text-sm font-bold tabular-nums whitespace-nowrap ${
                t.text
              } ${isVoided ? "line-through text-ks-fg-muted" : ""}`}
              data-testid={row._grouped ? "grouped-row-total" : undefined}
            >
              {tone.sign}
              {formatCurrency(amt)}
            </span>
            <Show when={isVoided}>
              <span
                class="text-[10px] font-bold tabular-nums whitespace-nowrap text-ks-danger uppercase tracking-wider"
                data-testid="transaction-row-voided-badge"
              >
                Voided
              </span>
            </Show>
            <Show when={showBalance}>
              <span
                class="text-[10px] font-bold tabular-nums whitespace-nowrap text-ks-accent uppercase tracking-wider"
                data-testid="transaction-row-balance"
                title="Outstanding balance"
              >
                Bal {formatCurrency(balanceNum)}
              </span>
            </Show>
          </div>
        );
      },
    },
    {
      data: null,
      title: "",
      className: "w-[28px]",
      render: (_val, _type, row) => {
        if (row._grouped) {
          const isOpen = expandedGroups().has(row._groupKey || "");
          return isOpen ? (
            <ChevronDown size={14} class="text-ks-accent inline" />
          ) : (
            <ChevronRight size={14} class="text-ks-fg-subtle inline" />
          );
        }
        return <ChevronRight size={14} class="text-ks-fg-subtle inline" />;
      },
    },
  ];
}
