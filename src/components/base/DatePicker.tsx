// Source: kserp src/components/ui/DatePicker/DatePicker.tsx (the host's Tailwind-
// classed picker). Ported into ksui as a DOMAIN-FREE base primitive: a trigger
// button labeled with the selected date (or "Pick date"), a calendar popover
// (month grid, prev/next nav, day selection), single-date AND range mode, an
// optional natural-language text input + quick-options, an optional time field,
// and an optional time toggle. The value/onChange contract matches the host
// exactly (single `string | null`, or a `DateRangeValue { start, end }`).
//
// Like Button / Modal / DataTable, ksui ships no sidecar .css — every Tailwind
// utility the host used is reproduced here as a runtime <style> tag (a stable
// id, injected once per page) referenced with plain, unscoped `ksui-datepicker-*`
// class names. Surface / border / accent colors read from the SAME `--ksui-dt-*`
// CSS custom properties the DataTable uses (so the two share one palette and a
// retint flows to both), plus a few picker-specific `--ksui-dp-*` vars; the
// fallback after each `var(...)` is the host's exact zinc + amber value.
//
// The host's `DatePickerURLSync` child (which read `?date=` via @solidjs/router)
// is intentionally dropped: ksui depends only on solid-js + lucide-solid, never
// the router. Callers that want URL persistence wire it from the outside.

import {
  createSignal,
  createMemo,
  createEffect,
  on,
  For,
  Show,
  onMount,
  onCleanup,
} from "solid-js";
import { Portal } from "solid-js/web";
import Calendar from "lucide-solid/icons/calendar";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Clock from "lucide-solid/icons/clock";
import X from "lucide-solid/icons/x";
import {
  parseDateInput,
  formatDateDisplay,
  formatDateEditable,
  formatTimeDisplay,
  normalizeDate,
  type ParsedDate,
} from "../../utils/parse-date";

// ---------------------------------------------------------------------------
// Injected CSS
// ---------------------------------------------------------------------------
//
// Shares the DataTable's `--ksui-dt-*` palette (accent / control-bg / border /
// fg / text / muted / faint), so wrapping a date filter and a table in the same
// retint container restyles both. Picker-only tones use `--ksui-dp-*`. Fallback
// after each `var(...)` = the host kserp DatePicker's exact Tailwind value.
//
//   --ksui-dt-control-bg   popover + trigger + input bg (zinc-900, #18181b)
//   --ksui-dt-border       borders / dividers (zinc-800/50, rgba(39,39,42,0.5))
//   --ksui-dt-fg           primary white-ish text (white, #ffffff)
//   --ksui-dt-text         secondary text (zinc-400, #a1a1aa)
//   --ksui-dt-muted        placeholder / day-header / hint (zinc-500, #71717a)
//   --ksui-dt-faint        "to" separator (zinc-600, #52525b)
//   --ksui-dt-accent       active accent text (amber-400, #fbbf24)
//   --ksui-dt-accent-border focus ring (amber-500/50, rgba(245,158,11,0.5))
//   --ksui-dp-trigger-active-bg active trigger bg (amber-600/10, rgba(217,119,6,0.1))
//   --ksui-dp-trigger-active-border active trigger border (amber-500/40, rgba(245,158,11,0.4))
//   --ksui-dp-trigger-active-text active trigger text (amber-400, #fbbf24)
//   --ksui-dp-row-hover    day-cell / nav hover bg (zinc-800/50, rgba(39,39,42,0.5))
//   --ksui-dp-cell-text    in-month day text (zinc-300, #d4d4d8)
//   --ksui-dp-cell-out     out-of-month day text (zinc-700, #3f3f46)
//   --ksui-dp-sel-bg       selected single-day bg (amber-600/30, rgba(217,119,6,0.3))
//   --ksui-dp-range-end-bg range start/end bg (amber-600/40, rgba(217,119,6,0.4))
//   --ksui-dp-range-mid-bg in-range bg (amber-500/15, rgba(245,158,11,0.15))
//   --ksui-dp-preview-bg   preview/hover bg (amber-500/10, rgba(245,158,11,0.1))
//   --ksui-dp-accent-soft  range/in-range/preview text (amber-300, #fcd34d)
//   --ksui-dp-input-bg     popover text-input bg (zinc-800/50, rgba(39,39,42,0.5))
//   --ksui-dp-input-border popover text-input border (zinc-700/50, rgba(63,63,70,0.5))
//   --ksui-dp-toggle-off   off switch bg (zinc-700, #3f3f46)
//   --ksui-dp-toggle-on    on switch bg (amber-500/80, rgba(245,158,11,0.8))
//   --ksui-dp-danger       clear-hover / time-error text (red-400, #f87171)
//   --ksui-dp-danger-border time-input invalid border (red-500/50, rgba(239,68,68,0.5))
//
const STYLE_ID = "ksui-datepicker-style";

const DATEPICKER_CSS = `
.ksui-datepicker{position:relative;display:flex;align-items:center;gap:0.25rem;}
.ksui-datepicker-trigger{display:inline-flex;cursor:pointer;align-items:center;gap:0.5rem;border-radius:0.5rem;border:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));background:var(--ksui-dt-control-bg,#18181b);padding:0.5rem 0.75rem;font-size:0.75rem;line-height:1rem;color:var(--ksui-dt-text,#a1a1aa);transition:color 0.15s ease,background-color 0.15s ease,border-color 0.15s ease;}
.ksui-datepicker-trigger:hover:not(:disabled){color:var(--ksui-dt-fg,#ffffff);}
.ksui-datepicker-trigger:disabled{cursor:not-allowed;opacity:0.5;}
.ksui-datepicker-trigger-active{border-color:var(--ksui-dp-trigger-active-border,rgba(245,158,11,0.4));background:var(--ksui-dp-trigger-active-bg,rgba(217,119,6,0.1));color:var(--ksui-dp-trigger-active-text,#fbbf24);}
.ksui-datepicker-clear-btn{border-radius:0.25rem;padding:0.25rem;color:var(--ksui-dt-muted,#71717a);background:transparent;border:0;cursor:pointer;display:inline-flex;transition:color 0.15s ease,background-color 0.15s ease;}
.ksui-datepicker-clear-btn:hover{background:var(--ksui-dp-row-hover,rgba(39,39,42,0.5));color:var(--ksui-dt-fg,#ffffff);}
.ksui-datepicker-popover{position:fixed;z-index:60;overflow-y:auto;border-radius:0.75rem;border:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));background:var(--ksui-dt-control-bg,#18181b);box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);}
.ksui-datepicker-section{padding:0.75rem;}
.ksui-datepicker-section-bordered{border-bottom:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));padding:0.75rem;}
.ksui-datepicker-input{width:100%;border-radius:0.5rem;border:1px solid var(--ksui-dp-input-border,rgba(63,63,70,0.5));background:var(--ksui-dp-input-bg,rgba(39,39,42,0.5));padding:0.5rem 0.75rem;font-size:0.875rem;line-height:1.25rem;color:var(--ksui-dt-fg,#ffffff);outline:none;transition:border-color 0.15s ease;}
.ksui-datepicker-input::placeholder{color:var(--ksui-dt-muted,#71717a);}
.ksui-datepicker-input:focus{border-color:var(--ksui-dt-accent-border,rgba(245,158,11,0.5));}
.ksui-datepicker-range-row{display:flex;align-items:center;gap:0.5rem;}
.ksui-datepicker-range-input{flex:1 1 0%;}
.ksui-datepicker-range-input-active{border-color:var(--ksui-dt-accent-border,rgba(245,158,11,0.5));}
.ksui-datepicker-range-sep{font-size:0.75rem;color:var(--ksui-dt-faint,#52525b);}
.ksui-datepicker-preview{margin-top:0.5rem;display:flex;align-items:center;gap:0.5rem;font-size:0.75rem;}
.ksui-datepicker-preview-chip{border-radius:0.25rem;background:var(--ksui-dp-preview-bg,rgba(245,158,11,0.1));padding:0.125rem 0.5rem;color:var(--ksui-dt-accent,#fbbf24);}
.ksui-datepicker-preview-hint{color:var(--ksui-dt-muted,#71717a);}
.ksui-datepicker-quick{display:flex;gap:0.375rem;border-bottom:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));padding:0.5rem 0.75rem;}
.ksui-datepicker-quick-btn{border-radius:0.375rem;padding:0.25rem 0.5rem;font-size:0.75rem;color:var(--ksui-dt-text,#a1a1aa);background:transparent;border:0;cursor:pointer;transition:background-color 0.15s ease,color 0.15s ease;}
.ksui-datepicker-quick-btn:hover{background:var(--ksui-dp-row-hover,rgba(39,39,42,0.5));color:var(--ksui-dt-fg,#ffffff);}
.ksui-datepicker-quick-btn-active{background:var(--ksui-dp-range-mid-bg,rgba(245,158,11,0.2));color:var(--ksui-dt-accent,#fbbf24);}
.ksui-datepicker-quick-btn-active:hover{background:var(--ksui-dp-range-mid-bg,rgba(245,158,11,0.2));color:var(--ksui-dt-accent,#fbbf24);}
.ksui-datepicker-nav{margin-bottom:0.5rem;display:flex;align-items:center;justify-content:space-between;}
.ksui-datepicker-nav-btn{border-radius:0.25rem;padding:0.25rem;color:var(--ksui-dt-text,#a1a1aa);background:transparent;border:0;cursor:pointer;display:inline-flex;transition:background-color 0.15s ease,color 0.15s ease;}
.ksui-datepicker-nav-btn:hover{background:var(--ksui-dp-row-hover,rgba(39,39,42,0.5));color:var(--ksui-dt-fg,#ffffff);}
.ksui-datepicker-month-label{font-size:0.875rem;font-weight:500;color:var(--ksui-dt-fg,#e4e4e7);}
.ksui-datepicker-dow{margin-bottom:0.25rem;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));text-align:center;font-size:0.75rem;color:var(--ksui-dt-muted,#71717a);}
.ksui-datepicker-dow span{padding:0.25rem 0;}
.ksui-datepicker-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;}
.ksui-datepicker-cell{border-radius:0.25rem;padding:0.375rem 0;text-align:center;font-size:0.75rem;color:var(--ksui-dp-cell-text,#d4d4d8);background:transparent;border:0;cursor:pointer;transition:background-color 0.15s ease,color 0.15s ease;}
.ksui-datepicker-cell:hover{background:var(--ksui-dp-row-hover,rgba(39,39,42,0.5));color:var(--ksui-dt-fg,#ffffff);}
.ksui-datepicker-cell-out{color:var(--ksui-dp-cell-out,#3f3f46);}
.ksui-datepicker-cell-out:hover{background:var(--ksui-dp-preview-bg,rgba(39,39,42,0.5));color:var(--ksui-dt-muted,#71717a);}
.ksui-datepicker-cell-today{font-weight:500;color:var(--ksui-dt-accent,#fbbf24);}
.ksui-datepicker-cell-selected{background:var(--ksui-dp-sel-bg,rgba(217,119,6,0.3));font-weight:500;color:var(--ksui-dt-accent,#fbbf24);}
.ksui-datepicker-cell-selected:hover{background:var(--ksui-dp-sel-bg,rgba(217,119,6,0.3));color:var(--ksui-dt-accent,#fbbf24);}
.ksui-datepicker-cell-preview{background:var(--ksui-dp-preview-bg,rgba(245,158,11,0.1));font-weight:500;color:var(--ksui-dp-accent-soft,#fcd34d);}
.ksui-datepicker-cell-range-end{background:var(--ksui-dp-range-end-bg,rgba(217,119,6,0.4));font-weight:500;color:var(--ksui-dp-accent-soft,#fcd34d);}
.ksui-datepicker-cell-range-end:hover{background:var(--ksui-dp-range-end-bg,rgba(217,119,6,0.4));color:var(--ksui-dp-accent-soft,#fcd34d);}
.ksui-datepicker-cell-in-range{background:var(--ksui-dp-range-mid-bg,rgba(245,158,11,0.15));color:var(--ksui-dp-accent-soft,#fcd34d);}
.ksui-datepicker-cell-in-range:hover{background:var(--ksui-dp-range-mid-bg,rgba(245,158,11,0.15));color:var(--ksui-dp-accent-soft,#fcd34d);}
.ksui-datepicker-cell-range-preview{background:var(--ksui-dp-preview-bg,rgba(245,158,11,0.1));color:var(--ksui-dp-accent-soft,#fcd34d);}
.ksui-datepicker-toggle-row{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));padding:0.5rem 0.75rem;font-size:0.75rem;color:var(--ksui-dt-fg,#d4d4d8);}
.ksui-datepicker-switch{position:relative;height:1rem;width:1.75rem;border-radius:9999px;padding:0.125rem;border:0;cursor:pointer;background:var(--ksui-dp-toggle-off,#3f3f46);transition:background-color 0.15s ease;}
.ksui-datepicker-switch-on{background:var(--ksui-dp-toggle-on,rgba(245,158,11,0.8));}
.ksui-datepicker-switch-knob{display:block;height:0.75rem;width:0.75rem;border-radius:9999px;background:#ffffff;transition:transform 0.15s ease;transform:translateX(0);}
.ksui-datepicker-switch-on .ksui-datepicker-switch-knob{transform:translateX(0.75rem);}
.ksui-datepicker-time-row{border-top:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));padding:0.5rem 0.75rem;}
.ksui-datepicker-time-inner{display:flex;align-items:center;gap:0.5rem;}
.ksui-datepicker-time-icon{color:var(--ksui-dt-muted,#71717a);display:inline-flex;}
.ksui-datepicker-time-input{flex:1 1 0%;border-radius:0.25rem;border:1px solid var(--ksui-dp-input-border,rgba(63,63,70,0.5));background:var(--ksui-dp-input-bg,rgba(39,39,42,0.5));padding:0.25rem 0.5rem;font-size:0.75rem;color:var(--ksui-dt-fg,#ffffff);outline:none;transition:border-color 0.15s ease;}
.ksui-datepicker-time-input::placeholder{color:var(--ksui-dt-muted,#71717a);}
.ksui-datepicker-time-input:focus{border-color:var(--ksui-dt-accent-border,rgba(245,158,11,0.5));}
.ksui-datepicker-time-input-invalid{border-color:var(--ksui-dp-danger-border,rgba(239,68,68,0.5));}
.ksui-datepicker-time-clear{border-radius:0.25rem;padding:0.125rem;color:var(--ksui-dt-muted,#71717a);background:transparent;border:0;cursor:pointer;display:inline-flex;}
.ksui-datepicker-time-clear:hover{color:var(--ksui-dt-fg,#ffffff);}
.ksui-datepicker-time-error{margin-top:0.25rem;font-size:0.75rem;color:var(--ksui-dp-danger,#f87171);}
.ksui-datepicker-footer{display:flex;align-items:center;justify-content:flex-end;border-top:1px solid var(--ksui-dt-border,rgba(39,39,42,0.5));padding:0.5rem 0.75rem;}
.ksui-datepicker-footer-clear{font-size:0.75rem;color:var(--ksui-dt-muted,#71717a);background:transparent;border:0;cursor:pointer;transition:color 0.15s ease;}
.ksui-datepicker-footer-clear:hover{color:var(--ksui-dp-danger,#f87171);}
`;

function ensureDatePickerStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = DATEPICKER_CSS;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateRangeValue {
  start: string | null;
  end: string | null;
}

interface DatePickerSharedProps {
  placeholder?: string;
  withTime?: boolean;
  disabled?: boolean;
  /** Override the trigger button class entirely (escape hatch for custom triggers). */
  triggerClass?: string;
}

interface DatePickerSingleProps extends DatePickerSharedProps {
  range?: false;
  value: string | null;
  onChange: (date: string | null) => void;
}

interface DatePickerRangeProps extends DatePickerSharedProps {
  range: true;
  value: DateRangeValue;
  onChange: (range: DateRangeValue) => void;
}

export type DatePickerProps = DatePickerSingleProps | DatePickerRangeProps;

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function todayStr(): string {
  const d = new Date();
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

function offsetTodayStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

function offsetTodayMonthStr(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

interface SingleQuickOption {
  label: string;
  getDate: () => string;
}

interface RangeQuickOption {
  label: string;
  getRange: () => DateRangeValue;
}

const QUICK_OPTIONS_SINGLE: SingleQuickOption[] = [
  { label: "Today", getDate: () => todayStr() },
  { label: "Yesterday", getDate: () => offsetTodayStr(1) },
  { label: "Last week", getDate: () => offsetTodayStr(7) },
  { label: "Last month", getDate: () => offsetTodayMonthStr(1) },
];

const QUICK_OPTIONS_RANGE: RangeQuickOption[] = [
  {
    label: "Today",
    getRange: () => ({ start: todayStr(), end: todayStr() }),
  },
  {
    label: "Yesterday",
    getRange: () => {
      const y = offsetTodayStr(1);
      return { start: y, end: y };
    },
  },
  {
    label: "Last week",
    getRange: () => ({ start: offsetTodayStr(6), end: todayStr() }),
  },
  {
    label: "Last month",
    getRange: () => ({ start: offsetTodayMonthStr(1), end: todayStr() }),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DatePicker(props: DatePickerProps) {
  ensureDatePickerStyle();

  const isRange = (): boolean => (props as DatePickerProps).range === true;

  const singleValue = (): string | null =>
    isRange() ? null : ((props as DatePickerSingleProps).value ?? null);
  const rangeValue = (): DateRangeValue =>
    isRange()
      ? ((props as DatePickerRangeProps).value ?? { start: null, end: null })
      : { start: null, end: null };

  function emitSingle(value: string | null) {
    (props as DatePickerSingleProps).onChange(value);
  }
  function emitRange(value: DateRangeValue) {
    (props as DatePickerRangeProps).onChange(value);
  }

  const [open, setOpen] = createSignal(false);
  const [inputValue, setInputValue] = createSignal("");
  const [endInputValue, setEndInputValue] = createSignal("");
  const [activeField, setActiveField] = createSignal<"start" | "end">("start");
  const [preview, setPreview] = createSignal<ParsedDate | null>(null);
  const [time, setTime] = createSignal<string | undefined>(undefined);
  const [popoverPos, setPopoverPos] = createSignal({ top: 0, left: 0 });
  const [hoverDate, setHoverDate] = createSignal<string | null>(null);
  // When range mode is allowed, this reflects whether the user has actually
  // toggled "End date" on. Stays false (single-date UI) until the user opts in.
  const [endActive, setEndActive] = createSignal(false);
  // Whether the calendar/inputs are currently behaving as a range picker.
  const isRangeActive = (): boolean => isRange() && endActive();
  // Single source of truth for the popover's numeric width. openPicker (initial
  // position), reposition (on scroll/resize), and the rendered <div> all read
  // from here so they cannot drift apart and clamp to different left
  // coordinates when the trigger sits near the right edge of the viewport.
  const popoverPxWidth = (): number => (isRangeActive() ? 360 : 320);

  const today = new Date();
  const [viewYear, setViewYear] = createSignal(today.getFullYear());
  const [viewMonth, setViewMonth] = createSignal(today.getMonth());

  let inputRef: HTMLInputElement | undefined;
  let endInputRef: HTMLInputElement | undefined;
  let popoverRef: HTMLDivElement | undefined;
  // Separate ref for the portaled popover panel — popoverRef tracks the
  // in-tree trigger wrapper, popoverPanelRef tracks the panel rendered into
  // document.body. Both must be excluded from the outside-click handler;
  // otherwise clicks inside the calendar grid would dismiss it because the
  // wrapper no longer contains the portaled panel.
  let popoverPanelRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;

  const todayStrConst = todayStr();

  const normalizedSingle = createMemo(() => {
    const v = singleValue();
    return v ? normalizeDate(v) : null;
  });
  const normalizedStart = createMemo(() => {
    const v = rangeValue().start;
    return v ? normalizeDate(v) : null;
  });
  const normalizedEnd = createMemo(() => {
    const v = rangeValue().end;
    return v ? normalizeDate(v) : null;
  });

  // ── Calendar grid ──────────────────────────────────────────────────────────

  const monthLabel = createMemo(() => {
    const d = new Date(viewYear(), viewMonth(), 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  });

  const calendarDays = createMemo(() => {
    const y = viewYear();
    const m = viewMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const daysInPrev = new Date(y, m, 0).getDate();

    const cells: { day: number; dateStr: string; current: boolean }[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrev - i;
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      cells.push({ day: d, dateStr: toDateStr(py, pm, d), current: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, dateStr: toDateStr(y, m, d), current: true });
    }

    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const nm = m === 11 ? 0 : m + 1;
      const ny = m === 11 ? y + 1 : y;
      cells.push({ day: d, dateStr: toDateStr(ny, nm, d), current: false });
    }

    return cells;
  });

  // ── Navigation ─────────────────────────────────────────────────────────────

  function prevMonth() {
    if (viewMonth() === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth() === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  function selectDateSingle(dateStr: string) {
    emitSingle(dateStr);
    setInputValue(formatDateEditable(dateStr));
    setPreview(null);
  }

  function selectDateRange(dateStr: string) {
    // Range-mode click rules:
    //   1. The click only writes the field that's currently active. The other
    //      bound is preserved (e.g. picking a new start does NOT clobber an
    //      existing end). The previous version collapsed end onto start, which
    //      forced the user to re-pick end after every start change — that's
    //      what made the calendar look like it "lost" the end highlight.
    //   2. If the new pick would invert the range (start > end after a start
    //      click, or end < start after an end click), swap the bounds so the
    //      stored range stays valid. Notion / Linear behave this way; the
    //      alternative (showing an invalid range or wiping the other bound) is
    //      worse for the user.
    //   3. Focus and activeField never change here. The caller's input keeps
    //      its caret so they can keep typing or click another date.
    const cur = rangeValue();
    const field = activeField();

    let nextStart = cur.start;
    let nextEnd = cur.end;

    if (field === "start") {
      nextStart = dateStr;
      if (nextEnd && nextStart > nextEnd) {
        [nextStart, nextEnd] = [nextEnd, nextStart];
      }
    } else {
      nextEnd = dateStr;
      if (nextStart && nextEnd < nextStart) {
        [nextStart, nextEnd] = [nextEnd, nextStart];
      }
    }

    emitRange({ start: nextStart, end: nextEnd });
    setInputValue(nextStart ? formatDateEditable(nextStart) : "");
    setEndInputValue(nextEnd ? formatDateEditable(nextEnd) : "");
    setPreview(null);
  }

  /**
   * Called when range mode is allowed by the caller (range=true) but the user
   * has not toggled "End date" on. Behaves like single-date selection — both
   * start and end are set to the picked date so the caller's filter applies to
   * exactly that day, matching the prior single-date behavior.
   */
  function selectDateRangeStartOnly(dateStr: string) {
    emitRange({ start: dateStr, end: dateStr });
    setInputValue(formatDateEditable(dateStr));
    setPreview(null);
  }

  function selectDate(dateStr: string) {
    if (isRangeActive()) selectDateRange(dateStr);
    else if (isRange()) selectDateRangeStartOnly(dateStr);
    else selectDateSingle(dateStr);
  }

  function applyQuickRange(range: DateRangeValue) {
    // If the picked range covers more than one day, auto-enable the End-date
    // toggle so the calendar/inputs reflect the range the user just chose.
    if (range.end && range.end !== range.start) setEndActive(true);
    emitRange(range);
    setInputValue(range.start ? formatDateEditable(range.start) : "");
    setEndInputValue(range.end ? formatDateEditable(range.end) : "");
    setPreview(null);
  }

  function clear(e?: MouseEvent) {
    e?.stopPropagation();
    if (isRange()) emitRange({ start: null, end: null });
    else emitSingle(null);
    setTime(undefined);
    setInputValue("");
    setEndInputValue("");
    setPreview(null);
    setHoverDate(null);
    setActiveField("start");
    setOpen(false);
  }

  function setViewToAnchor() {
    const anchor = isRange() ? (normalizedStart() ?? normalizedEnd()) : normalizedSingle();
    if (anchor) {
      const d = new Date(anchor + "T00:00:00");
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    } else {
      setViewYear(today.getFullYear());
      setViewMonth(today.getMonth());
    }
  }

  function seedInputsFromValue() {
    if (isRange()) {
      const r = rangeValue();
      // Re-derive toggle state from current value: a true date span (start≠end)
      // means the user previously turned the toggle on; a single day or empty
      // value means the toggle stays off.
      const span = !!r.start && !!r.end && r.start !== r.end;
      setEndActive(span);
      setInputValue(r.start ? formatDateEditable(r.start) : "");
      setEndInputValue(r.end ? formatDateEditable(r.end) : "");
      setActiveField(r.start && !r.end ? "end" : "start");
    } else {
      const v = singleValue();
      setInputValue(v ? formatDateEditable(v) : "");
    }
  }

  function openPicker() {
    if (props.disabled || open()) return;
    setViewToAnchor();
    seedInputsFromValue();
    setPreview(null);
    setHoverDate(null);
    // Compute the popover's position BEFORE flipping `open` to true. The trigger
    // is already in the DOM, so getBoundingClientRect is valid right now; doing
    // the math here means the popover renders at the right coordinates on its
    // very first paint instead of briefly flashing at top:0/left:0 and then
    // jumping into place inside the next animation frame.
    if (triggerRef) {
      const rect = triggerRef.getBoundingClientRect();
      const vw = window.innerWidth;
      const width = popoverPxWidth();
      setPopoverPos({
        top: rect.bottom + 8,
        left: Math.max(8, Math.min(rect.left, vw - (width + 10))),
      });
    }
    setOpen(true);
    // Focus still has to wait one frame for the input element to be in the DOM.
    requestAnimationFrame(() => {
      inputRef?.focus();
      inputRef?.select();
    });
  }

  // ── Text input handling ────────────────────────────────────────────────────

  function handleInput(e: InputEvent, field: "start" | "end") {
    const val = (e.currentTarget as HTMLInputElement).value;
    if (field === "start") setInputValue(val);
    else setEndInputValue(val);
    setActiveField(field);

    const parsed = parseDateInput(val);
    setPreview(parsed);

    if (parsed) {
      const d = new Date(parsed.date + "T00:00:00");
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      const p = preview();
      if (p) {
        if (p.time) setTime(p.time);
        selectDate(p.date);
      }
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // ── Time input ─────────────────────────────────────────────────────────────

  const [timeInput, setTimeInput] = createSignal("");
  const [timeValid, setTimeValid] = createSignal(true);

  function handleTimeInput(e: InputEvent) {
    const val = (e.currentTarget as HTMLInputElement).value;
    setTimeInput(val);
  }

  function handleTimeBlur() {
    const val = timeInput().trim();
    if (!val) {
      setTime(undefined);
      setTimeValid(true);
      return;
    }
    const parsed = parseDateInput(`today ${val}`);
    if (parsed?.time) {
      setTime(parsed.time);
      setTimeValid(true);
      setTimeInput(formatTimeDisplay(parsed.time));
    } else {
      setTimeValid(false);
    }
  }

  function handleTimeKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      (e.currentTarget as HTMLInputElement).blur();
    }
  }

  createEffect(
    on(time, (t) => {
      if (t) setTimeInput(formatTimeDisplay(t));
    }),
  );

  // ── Click outside ──────────────────────────────────────────────────────────

  function handleClickOutside(e: MouseEvent) {
    if (
      popoverRef &&
      !popoverRef.contains(e.target as Node) &&
      triggerRef &&
      !triggerRef.contains(e.target as Node) &&
      (!popoverPanelRef || !popoverPanelRef.contains(e.target as Node))
    ) {
      setOpen(false);
    }
  }

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside);
    onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));
  });

  // ── Reposition on scroll / resize ──────────────────────────────────────────
  function reposition() {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = popoverPxWidth();
    setPopoverPos({
      top: rect.bottom + 8,
      left: Math.max(8, Math.min(rect.left, vw - (width + 10))),
    });
  }

  createEffect(() => {
    if (!open()) return;
    window.addEventListener("scroll", reposition, { passive: true, capture: true });
    window.addEventListener("resize", reposition);
    onCleanup(() => {
      window.removeEventListener("scroll", reposition, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", reposition);
    });
  });

  // ── Display value ──────────────────────────────────────────────────────────

  const displayValue = createMemo(() => {
    if (isRange()) {
      const r = rangeValue();
      if (!r.start && !r.end) return null;
      // Only one bound set ⇒ show just that date (no arrow). Both bounds set
      // and equal ⇒ single date. Otherwise ⇒ range.
      if (r.start && !r.end) return formatDateDisplay(r.start);
      if (!r.start && r.end) return formatDateDisplay(r.end);
      const s = formatDateDisplay(r.start!);
      const e = formatDateDisplay(r.end!);
      return r.start === r.end ? s : `${s} → ${e}`;
    }
    const v = singleValue();
    if (!v) return null;
    let text = formatDateDisplay(v);
    const t = time();
    if (t) text += ` ${formatTimeDisplay(t)}`;
    return text;
  });

  const hasValue = (): boolean => {
    if (isRange()) {
      const r = rangeValue();
      return !!(r.start || r.end);
    }
    return !!singleValue();
  };

  // ── Cell-state classifier (range mode) ─────────────────────────────────────

  function hoverPreviewState(dateStr: string, start: string): "preview" | null {
    const hov = hoverDate();
    if (!(hov && activeField() === "end")) return null;
    const lo = start < hov ? start : hov;
    const hi = start < hov ? hov : start;
    if (dateStr > lo && dateStr < hi) return "preview";
    if (dateStr === hov && hov !== start) return "preview";
    return null;
  }

  function rangeCellState(dateStr: string): "start" | "end" | "in-range" | "preview" | null {
    if (!isRangeActive()) return null;
    const r = rangeValue();
    const start = r.start ? normalizeDate(r.start) : null;
    const end = r.end ? normalizeDate(r.end) : null;

    if (start && dateStr === start) return "start";
    if (end && dateStr === end) return "end";
    if (start && end && dateStr > start && dateStr < end) return "in-range";

    if (start && !end) return hoverPreviewState(dateStr, start);
    return null;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const popoverWidth = () =>
    isRangeActive() ? "min(22.5rem,calc(100vw-2rem))" : "min(20rem,calc(100vw-2rem))";

  return (
    <div class="ksui-datepicker" ref={popoverRef}>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={openPicker}
        type="button"
        tabIndex={-1}
        disabled={props.disabled}
        class={
          props.triggerClass ??
          `ksui-datepicker-trigger ${hasValue() ? "ksui-datepicker-trigger-active" : ""}`
        }
      >
        <Calendar size={14} />
        <span>{displayValue() ?? props.placeholder ?? "Pick date"}</span>
      </button>
      {/* Clear button */}
      <Show when={hasValue()}>
        <button type="button" tabIndex={-1} class="ksui-datepicker-clear-btn" onClick={clear}>
          <X size={14} />
        </button>
      </Show>

      {/* Popover — portaled to document.body so ancestor clip-path / overflow
          (sheet modals use clip-path corners) doesn't clip the calendar. */}
      <Show when={open()}>
        <Portal>
          <div
            ref={popoverPanelRef}
            data-testid="datepicker-popover"
            class="ksui-datepicker-popover"
            style={{
              top: `${popoverPos().top}px`,
              left: `${popoverPos().left}px`,
              width: popoverWidth(),
              // Keep the popover inside the viewport on short screens (mobile,
              // or when the trigger sits near the bottom). Without this, the
              // calendar's lower rows fall off the bottom of the screen with
              // no scroll path — `position: fixed` ignores page scroll.
              "max-height": `calc(100vh - ${popoverPos().top}px - 8px)`,
            }}
          >
            {/* Text input(s) */}
            <div class="ksui-datepicker-section-bordered">
              <Show when={!isRangeActive()}>
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue()}
                  onInput={(e) => handleInput(e, "start")}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a date... dec 3, yesterday, last week"
                  class="ksui-datepicker-input"
                />
              </Show>
              <Show when={isRangeActive()}>
                <div class="ksui-datepicker-range-row">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue()}
                    onInput={(e) => handleInput(e, "start")}
                    onFocus={() => setActiveField("start")}
                    onKeyDown={handleKeyDown}
                    placeholder="Start"
                    data-testid="datepicker-range-start"
                    class={`ksui-datepicker-input ksui-datepicker-range-input ${
                      activeField() === "start" ? "ksui-datepicker-range-input-active" : ""
                    }`}
                  />
                  <span class="ksui-datepicker-range-sep">to</span>
                  <input
                    ref={endInputRef}
                    type="text"
                    value={endInputValue()}
                    onInput={(e) => handleInput(e, "end")}
                    onFocus={() => setActiveField("end")}
                    onKeyDown={handleKeyDown}
                    placeholder="End"
                    data-testid="datepicker-range-end"
                    class={`ksui-datepicker-input ksui-datepicker-range-input ${
                      activeField() === "end" ? "ksui-datepicker-range-input-active" : ""
                    }`}
                  />
                </div>
              </Show>
              <Show when={preview()}>
                <div class="ksui-datepicker-preview">
                  <span class="ksui-datepicker-preview-chip">
                    {formatDateDisplay(preview()!.date)}
                    {preview()!.time && ` at ${formatTimeDisplay(preview()!.time!)}`}
                  </span>
                  <span class="ksui-datepicker-preview-hint">Press Enter to select</span>
                </div>
              </Show>
            </div>

            {/* Quick options. In range mode the picker emits a range shape regardless
              of toggle state, but the labels still match what the user sees: a single
              date when the End-date toggle is off, a span when it's on. */}
            <div class="ksui-datepicker-quick">
              <Show when={!isRange()}>
                <For each={QUICK_OPTIONS_SINGLE}>
                  {(opt) => (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectDate(opt.getDate())}
                      class={`ksui-datepicker-quick-btn ${
                        normalizedSingle() === opt.getDate() ? "ksui-datepicker-quick-btn-active" : ""
                      }`}
                    >
                      {opt.label}
                    </button>
                  )}
                </For>
              </Show>
              <Show when={isRange()}>
                <For each={QUICK_OPTIONS_RANGE}>
                  {(opt) => {
                    const isActive = () => {
                      const r = rangeValue();
                      const target = opt.getRange();
                      return r.start === target.start && r.end === target.end;
                    };
                    return (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyQuickRange(opt.getRange())}
                        class={`ksui-datepicker-quick-btn ${
                          isActive() ? "ksui-datepicker-quick-btn-active" : ""
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  }}
                </For>
              </Show>
            </div>

            {/* Calendar */}
            <div class="ksui-datepicker-section">
              {/* Month nav */}
              <div class="ksui-datepicker-nav">
                <button type="button" onClick={prevMonth} class="ksui-datepicker-nav-btn">
                  <ChevronLeft size={16} />
                </button>
                <span class="ksui-datepicker-month-label">{monthLabel()}</span>
                <button type="button" onClick={nextMonth} class="ksui-datepicker-nav-btn">
                  <ChevronRight size={16} />
                </button>
              </div>

              {/* Day headers */}
              <div class="ksui-datepicker-dow">
                <For each={DAYS}>{(d) => <span>{d}</span>}</For>
              </div>

              {/* Day cells */}
              <div class="ksui-datepicker-grid">
                <For each={calendarDays()}>
                  {(cell) => {
                    // Single-style "selected" covers both the no-range path
                    // (highlight `value`) and the range-but-toggle-off path
                    // (highlight `value.start`, since end isn't in play yet).
                    const isSelectedSingle = () => {
                      if (isRangeActive()) return false;
                      if (!isRange()) return normalizedSingle() === cell.dateStr;
                      return normalizedStart() === cell.dateStr;
                    };
                    const isPreviewSingle = () =>
                      !isRangeActive() && preview()?.date === cell.dateStr && !isSelectedSingle();
                    const isToday = () => cell.dateStr === todayStrConst;
                    const rangeState = createMemo(() => rangeCellState(cell.dateStr));
                    const cellStateClass = (): string => {
                      if (!cell.current) return "ksui-datepicker-cell-out";
                      const rs = rangeState();
                      if (rs === "start" || rs === "end") return "ksui-datepicker-cell-range-end";
                      if (rs === "in-range") return "ksui-datepicker-cell-in-range";
                      if (rs === "preview") return "ksui-datepicker-cell-range-preview";
                      if (isSelectedSingle()) return "ksui-datepicker-cell-selected";
                      if (isPreviewSingle()) return "ksui-datepicker-cell-preview";
                      if (isToday()) return "ksui-datepicker-cell-today";
                      return "";
                    };
                    return (
                      <button
                        type="button"
                        // Keep focus on whichever text input was active so the
                        // user can keep typing after clicking a date. Without
                        // this, the click moves focus to the day button and the
                        // input loses its caret.
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => isRangeActive() && setHoverDate(cell.dateStr)}
                        onMouseLeave={() => isRangeActive() && setHoverDate(null)}
                        class={`ksui-datepicker-cell ${cellStateClass()}`}
                        onClick={() => selectDate(cell.dateStr)}
                      >
                        {cell.day}
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>

            {/* End-date toggle (only when caller has opted in via range=true). */}
            <Show when={isRange()}>
              <div class="ksui-datepicker-toggle-row">
                <span>End date</span>
                <button
                  type="button"
                  role="switch"
                  aria-label="End date"
                  aria-checked={endActive()}
                  data-testid="datepicker-end-date-toggle"
                  onClick={() => {
                    const next = !endActive();
                    setEndActive(next);
                    if (!next) {
                      // Toggling off: collapse end onto start so the filter is a
                      // single day. If start is empty, clear end too.
                      const r = rangeValue();
                      emitRange({ start: r.start, end: r.start });
                      setEndInputValue(r.start ? formatDateEditable(r.start) : "");
                    } else {
                      // Toggling on: focus the end input so the user can pick.
                      setActiveField("end");
                      requestAnimationFrame(() => endInputRef?.focus());
                    }
                  }}
                  class={`ksui-datepicker-switch ${endActive() ? "ksui-datepicker-switch-on" : ""}`}
                >
                  <span class="ksui-datepicker-switch-knob" />
                </button>
              </div>
            </Show>

            {/* Time input (single mode only) */}
            <Show when={props.withTime && !isRange()}>
              <div class="ksui-datepicker-time-row">
                <div class="ksui-datepicker-time-inner">
                  <span class="ksui-datepicker-time-icon">
                    <Clock size={14} />
                  </span>
                  <input
                    type="text"
                    value={timeInput()}
                    onInput={handleTimeInput}
                    onBlur={handleTimeBlur}
                    onKeyDown={handleTimeKeyDown}
                    placeholder="7pm, 7:00pm, 19:00"
                    class={`ksui-datepicker-time-input ${
                      timeValid() ? "" : "ksui-datepicker-time-input-invalid"
                    }`}
                  />
                  <Show when={time()}>
                    <button
                      type="button"
                      onClick={() => {
                        setTime(undefined);
                        setTimeInput("");
                        setTimeValid(true);
                      }}
                      class="ksui-datepicker-time-clear"
                    >
                      <X size={12} />
                    </button>
                  </Show>
                </div>
                <Show when={!timeValid()}>
                  <p class="ksui-datepicker-time-error">Try: 5pm, 5:30pm, or 17:00</p>
                </Show>
              </div>
            </Show>

            {/* Footer — only shown when there is a value to clear. The "Today"
              shortcut already lives in the quick-options strip above, so a
              duplicate here would be redundant. */}
            <Show when={hasValue()}>
              <div class="ksui-datepicker-footer">
                <button type="button" class="ksui-datepicker-footer-clear" onClick={() => clear()}>
                  Clear
                </button>
              </div>
            </Show>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
