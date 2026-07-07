// UI-neutral shared module for the folded-in Analytics feature: types, date
// helpers, and the executable retryFlow — imported by BOTH the UI page and the
// server flow graph. It carries NO solid-js/DOM and NO server-only deps, so it is
// safe on both sides; retryFlow lives here (not in server/) so the UI never imports
// from server/ (the forbidden ui→server edge). Currency formatting reuses
// ../lib/format; the two date shapes here (short "Jul 7", full weekday) are
// analytics-specific and differ from format.ts's year-bearing formatDate.
import type { ExecFlow } from "@kahitsan/plugin-sdk/flow";

/**
 * EXECUTABLE flow (Vision §9): the Retry click IS this graph. runFlow walks
 * click → clear error → re-run all fetches, the exact "analytics.retry" path the
 * Connections tab renders. Shared so the server's /__meta/flows graph and the UI's
 * runFlow dispatch stay ONE source — the diagram cannot drift from the behaviour.
 */
export const retryFlow: ExecFlow = {
  id: "analytics.retry.exec",
  title: "Retry Analytics Fetches",
  nodes: [
    {
      id: "retry",
      kind: "trigger",
      label: "Click Retry",
      out: [{ id: "o", to: "clear" }],
    },
    {
      id: "clear",
      kind: "effect",
      label: "Clear error + re-run all fetches",
      effect: "refresh",
      out: [{ id: "o", to: "done" }],
    },
    { id: "done", kind: "terminal", label: "Resolved" },
  ],
};

export interface CashflowBucket {
  date: string;
  in: number;
  out: number;
  transfer: number;
}

export interface FinancialAccount {
  id: number;
  name: string;
  type: string;
  is_active: boolean;
  balance?: number | string;
  icon?: string | null;
  color?: string | null;
  s3_link?: string | null;
}

export interface UpcomingPayable {
  id: number;
  status: string;
  description: string;
  payee: string | null;
  amount: string;
  transaction_date: string;
  due_date: string | null;
}

/** Today's civil date in Asia/Manila, as a Date anchored at LOCAL midnight so day
 *  arithmetic (getDay/setDate) and Y/M/D reads stay on Manila's calendar day —
 *  kserp is PHT-only (Timezone discipline). Reconstructing from Manila's civil
 *  parts keeps it correct even off a UTC-TZ browser/CI runner, where a bare
 *  `new Date().toISOString()` would report the previous UTC day before 08:00 PHT. */
export function manilaToday(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return new Date(get("year"), get("month") - 1, get("day"));
}

/** Local `YYYY-MM-DD` (no UTC shift) — pair with manilaToday()/local-midnight Dates. */
export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Not ksui's formatShortDate/formatFullDate: those local-midnight-parse the same
// way but emit different shapes — formatShortDate carries the YEAR ("Jul 7, 2026")
// and formatFullDate is date+TIME ("Jul 7, 2026 · 3:04 PM"). The chart axis wants a
// bare "Jul 7" and the chart heading a weekday "Monday, July 7, 2026", so these are
// distinct formatters, not a fork of the shared ones.

/** Parse the date part as local midnight so a stored `date` (or an ISO with a
 *  time) renders on the calendar day it names, not shifted by the browser's UTC
 *  offset — PHT is UTC+8, so a naive parse of a bare date lands on the prior day. */
export function fmtShortDateLocal(iso: string | undefined): string {
  if (!iso) return "";
  const datePart = iso.includes("T") ? iso.split("T")[0] : iso;
  return new Date(datePart + "T00:00:00").toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  });
}

/** Full weekday/long-month/day/year, local-midnight parsed (see fmtShortDateLocal). */
export function fmtFullDateLocal(iso: string | undefined): string {
  if (!iso) return "";
  const datePart = iso.includes("T") ? iso.split("T")[0] : iso;
  return new Date(datePart + "T00:00:00").toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
