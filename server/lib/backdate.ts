/**
 * Timezone-aware "today" helper for the backdate permission gate.
 *
 * The monolith read `workspaces.timezone` (a kernel-owned tenant table) to
 * anchor "today" to the workspace's local frame. In the process-isolation model the
 * plugin MUST NOT read kernel tenant tables, so we anchor to the project
 * default (Asia/Manila) — the only timezone any KahitSan org uses today. If
 * the kernel later forwards the org timezone in the signed identity, swap the
 * constant for that forwarded value; the gate logic is otherwise unchanged.
 */

const ORG_TZ = "Asia/Manila";

/** Today (YYYY-MM-DD) in the project's org timezone. Uses Intl with the en-CA
 *  locale because it renders dates as ISO-style YYYY-MM-DD, which sorts and
 *  compares as a string. */
export function todayInOrgTimezone(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TZ }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** True when `dateStr` differs from "today" in the org's local timezone. A
 *  future-dated entry counts as backdated for audit purposes, matching the
 *  monolith's generic-POST gate semantics. */
export function isBackdated(dateStr: string, now: Date = new Date()): boolean {
  return dateStr !== todayInOrgTimezone(now);
}
