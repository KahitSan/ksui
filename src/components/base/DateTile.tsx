// DateTile — a compact calendar day cell.
//
// A 60x68 tile with three stacked parts: a small top band (e.g. a month
// label), a big primary value (e.g. the day-of-month), and an optional
// muted sub-label (e.g. hours worked, a count, a short note). It is the
// visual unit a caller repeats into a ledger-style row of days — scanned
// like a register, not rendered as a full month grid.
//
// Domain-free by design: it knows nothing about timesheets, payroll, or any
// data shape. The caller formats every string it shows (`topLabel`,
// `value`, `subLabel`) and owns selection state. Pass `onToggle` to make the
// tile an interactive, selectable button (with `aria-pressed`); omit it for a
// static, read-only cell that renders dimmed so a row can show which tiles are
// "in" vs "out" of a selection at a glance.

import { Show, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

export interface DateTileProps {
  /** The big primary value — typically a day-of-month number, but any short
   *  string works (the caller formats it). */
  value: number | string;
  /** Small uppercase band above the value, e.g. a month label ("MAY"). */
  topLabel?: string;
  /** Muted line below the value, e.g. "10h" or a short count. */
  subLabel?: string;
  /** Selected state. For interactive tiles this drives the amber accent +
   *  `aria-pressed`; ignored for read-only tiles (they always render "on"). */
  selected?: boolean;
  /** Make the tile a selectable button. When omitted the tile is a static,
   *  non-interactive cell. */
  onToggle?: () => void;
  /** Optional test id, applied only to interactive tiles. */
  testId?: string;
}

export default function DateTile(props: DateTileProps): JSX.Element {
  const interactive = (): boolean => !!props.onToggle;
  const on = (): boolean => (interactive() ? props.selected ?? false : true);
  return (
    <Dynamic
      component={interactive() ? "button" : "div"}
      type={interactive() ? "button" : undefined}
      onClick={props.onToggle}
      aria-pressed={interactive() ? on() : undefined}
      data-testid={interactive() ? props.testId : undefined}
      style={{ width: "60px", height: "68px", flex: "0 0 auto" }}
      class={`${interactive() ? "cursor-pointer" : ""} flex flex-col rounded-md overflow-hidden border transition-colors`}
      classList={{
        "border-amber-500/25 bg-zinc-800/40": on(),
        "border-zinc-800/60 bg-zinc-900/40 opacity-50 hover:opacity-80": !on(),
      }}
    >
      <div
        style={{ height: "18px" }}
        class="flex items-center justify-center text-[9px] font-semibold uppercase tracking-[0.15em] bg-zinc-800/70 text-zinc-500"
      >
        {props.topLabel ?? ""}
      </div>
      <div class="flex-1 flex flex-col items-center justify-center">
        <div
          class="text-xl font-semibold leading-none tabular-nums"
          classList={{
            "text-amber-400/90": on(),
            "text-zinc-500": !on(),
          }}
        >
          {props.value}
        </div>
        <Show when={props.subLabel != null && props.subLabel !== ""}>
          <div
            class="text-[9px] mt-0.5 tabular-nums"
            classList={{
              "text-zinc-500": on(),
              "text-zinc-700": !on(),
            }}
          >
            {props.subLabel}
          </div>
        </Show>
      </div>
    </Dynamic>
  );
}
