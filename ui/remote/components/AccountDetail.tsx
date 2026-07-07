// Read-only detail pane for a financial account, shown inside the detail Modal
// when not editing. Mostly pure presentation off the account record; the one
// async bit (A1) is streaming the logo's bytes through the authed /logo/raw route
// and rendering a same-origin blob: — the SOLE logo read path, with no public or
// signed S3 URL ever in the DOM.

import { Show } from "solid-js";
import { createObjectUrlResource } from "@kahitsan/ksui";
import {
  type FinancialAccount,
  TYPE_LABELS,
  capitalRowFigures,
  formatCurrency,
} from "../lib/accounts.js";

export function AccountDetail(props: {
  account: FinancialAccount;
  // The /logo/raw route is workspace-scoped, so the blob fetch must carry the same
  // X-Workspace-Id header (+ cookies) every sibling fetch sends, or it 404s and the
  // logo doesn't render.
  wsHeaders: () => HeadersInit;
}) {
  const a = props.account;
  const t = TYPE_LABELS[a.type] || { label: a.type, class: "" };

  // A1 proxy/blob: stream the logo's bytes through the authed /logo/raw route and
  // expose them as a same-origin blob:. No public/signed S3 URL reaches the DOM, so
  // no stored-XSS scheme check is needed (a blob: is created by us, never user input).
  // The workspace header rides the fetch (the route is workspace-scoped); the blob is
  // revoked on unmount. A logo that 404s simply doesn't render (the Show gates on it).
  const logoSrc = createObjectUrlResource(
    () => `/api/financial-accounts/${props.account.id}/logo/raw`,
    { init: { headers: props.wsHeaders() } },
  );

  return (
    <div class="space-y-4">
      <Show when={logoSrc()}>
        <div class="flex justify-center">
          <img
            src={logoSrc()!}
            alt={`${a.name} logo`}
            class="w-24 h-24 rounded-xl object-cover border border-zinc-700 bg-zinc-900 shadow"
          />
        </div>
      </Show>
      <DetailRow label="Name" value={a.name} />
      <div>
        <span class="text-xs text-zinc-500 block mb-1">Type</span>
        <span
          class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wider border ${t.class}`}
        >
          {t.label}
        </span>
      </div>
      <Show
        when={a.balance !== undefined && a.balance !== null}
        fallback={
          <div>
            <span class="text-xs text-zinc-500 block mb-1">Balance</span>
            <span class="text-sm text-zinc-400">
              — (available once Transactions is enabled)
            </span>
          </div>
        }
      >
        <Show
          when={a.type === "capital"}
          fallback={
            <div>
              <span class="text-xs text-zinc-500 block mb-1">Balance</span>
              <span
                class="text-lg font-semibold"
                classList={{
                  "text-emerald-400":
                    (typeof a.balance === "string"
                      ? parseFloat(a.balance)
                      : a.balance ?? 0) > 0,
                  "text-red-400":
                    (typeof a.balance === "string"
                      ? parseFloat(a.balance)
                      : a.balance ?? 0) < 0,
                  "text-zinc-400":
                    (typeof a.balance === "string"
                      ? parseFloat(a.balance)
                      : a.balance ?? 0) === 0,
                }}
              >
                {formatCurrency(a.balance!)}
              </span>
            </div>
          }
        >
          {(() => {
            const fig = capitalRowFigures(a.balance!);
            if (fig.overpaid) {
              return (
                <div>
                  <span class="text-xs text-zinc-500 block mb-1">
                    Overpayment
                  </span>
                  <span class="text-lg font-semibold text-red-400">
                    +{formatCurrency(fig.overpayment)}
                  </span>
                  <p class="text-xs text-zinc-500 mt-1">
                    More has been returned than contributed. Double-check the
                    account's transactions.
                  </p>
                </div>
              );
            }
            return (
              <div>
                <span class="text-xs text-zinc-500 block mb-1">
                  {fig.outstanding === 0
                    ? "Outstanding"
                    : "Outstanding (to return)"}
                </span>
                <span
                  class="text-lg font-semibold"
                  classList={{
                    "text-amber-400": fig.outstanding > 0,
                    "text-zinc-400": fig.outstanding === 0,
                  }}
                >
                  {formatCurrency(fig.outstanding)}
                </span>
                <p class="text-xs text-zinc-500 mt-1">
                  Net contribution still owed back to the funder.
                </p>
              </div>
            );
          })()}
        </Show>
      </Show>
      <DetailRow label="Description" value={a.description} />
      <DetailRow label="Status" value={a.is_active ? "Active" : "Archived"} />
      <DetailRow
        label="Created"
        value={new Date(a.created_at).toLocaleString()}
      />
    </div>
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
