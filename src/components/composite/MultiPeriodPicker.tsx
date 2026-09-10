import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import CalendarDays from "lucide-solid/icons/calendar-days";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import X from "lucide-solid/icons/x";
import { injectCSS } from "../../utils/inject-css";

export type MultiPeriodGranularity = "day" | "week" | "month" | "year";

export interface MultiPeriodToken {
  token: string;
  label: string;
}

export interface MultiPeriodTokenRenderProps extends MultiPeriodToken {
  selected: boolean;
}

export interface MultiPeriodPickerProps {
  granularity: MultiPeriodGranularity;
  onGranularityChange: (granularity: MultiPeriodGranularity) => void;
  selected: string[];
  onSelectedChange: (tokens: string[]) => void;
  /** Optional labels for tabs, trigger summary units, and picker headings. */
  labels?: Partial<{
    day: string;
    week: string;
    month: string;
    year: string;
    selected: string;
    period: string;
    pick: string;
  }>;
  /** Replaces token button contents without coupling the picker to a domain. */
  renderToken?: (token: MultiPeriodTokenRenderProps) => JSX.Element;
  /** Controls the civil date used for the initial view and year list. */
  now?: Date;
  /** Optional IANA zone used only to derive the current civil date. */
  timeZone?: string;
  disabled?: boolean;
  class?: string;
}

const STYLE_ID = "ksui-multi-period-picker-style";
const CSS = `
.ksui-mpp{position:relative;display:flex;flex-direction:column;gap:.5rem}
.ksui-mpp-tabs{display:flex;flex-wrap:wrap;gap:.25rem}
.ksui-mpp-tab,.ksui-mpp-trigger,.ksui-mpp-nav,.ksui-mpp-token,.ksui-mpp-chip{border:1px solid var(--ksui-mpp-border,var(--ks-border,rgba(39,39,42,0.5)));background:transparent;color:var(--ksui-mpp-muted,var(--ks-fg-muted,#a1a1aa));cursor:pointer;transition:background-color .15s ease,color .15s ease,border-color .15s ease}
.ksui-mpp-tab{border-radius:.375rem;padding:.4rem .65rem;font-size:.75rem}
.ksui-mpp-tab:hover,.ksui-mpp-nav:hover,.ksui-mpp-token:hover,.ksui-mpp-chip:hover{background:var(--ksui-mpp-hover,var(--ks-surface-raised,#1a1a1a));color:var(--ksui-mpp-fg,var(--ks-fg,#ffffff))}
.ksui-mpp-selected{border-color:var(--ksui-mpp-accent,var(--ks-accent,#fbbf24));background:color-mix(in srgb, var(--ks-primary, #c9a961) 18%, transparent);color:var(--ksui-mpp-accent,var(--ks-accent,#fbbf24));font-weight:600}
.ksui-mpp-trigger{display:inline-flex;align-items:center;gap:.5rem;border-radius:.5rem;padding:.5rem .75rem;font-size:.75rem;text-align:left}
.ksui-mpp-trigger:disabled{cursor:not-allowed;opacity:.5}
.ksui-mpp-popover{position:fixed;z-index:100;overflow-y:auto;border:1px solid var(--ksui-mpp-border,var(--ks-border,rgba(39,39,42,0.5)));border-radius:.75rem;background:var(--ksui-mpp-bg,var(--ks-input-bg,#18181b));box-shadow:var(--ks-shadow-lg,0 12px 32px rgba(0,0,0,0.6));padding:.75rem}
.ksui-mpp-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;color:var(--ksui-mpp-fg,var(--ks-fg,#ffffff));font-size:.75rem;font-weight:600}
.ksui-mpp-nav{display:inline-flex;border:0;border-radius:.25rem;padding:.25rem}
.ksui-mpp-grid{display:grid;gap:.375rem}
.ksui-mpp-grid-days{grid-template-columns:repeat(7,minmax(0,1fr))}
.ksui-mpp-grid-months{grid-template-columns:repeat(4,minmax(0,1fr))}
.ksui-mpp-grid-years{grid-template-columns:repeat(2,minmax(0,1fr))}
.ksui-mpp-token{border-radius:.375rem;padding:.4rem .45rem;font-size:.7rem;text-align:center}
.ksui-mpp-chip{display:inline-flex;align-items:center;gap:.25rem;border-radius:.375rem;padding:.25rem .4rem;font-size:.68rem}
.ksui-mpp-chips{display:flex;flex-wrap:wrap;gap:.25rem;border-top:1px solid var(--ksui-mpp-border,var(--ks-border,rgba(39,39,42,0.5)));padding-top:.6rem;margin-top:.7rem}
.ksui-mpp-week-label{margin:.6rem 0 .35rem;color:var(--ksui-mpp-muted,var(--ks-fg-subtle,#71717a));font-size:.65rem;text-transform:uppercase;letter-spacing:.12em}
.ksui-mpp-months{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:.25rem;margin-bottom:.6rem}
.ksui-mpp-month{border:1px solid var(--ksui-mpp-border,var(--ks-border,rgba(39,39,42,0.5)));border-radius:.3rem;background:transparent;color:var(--ksui-mpp-muted,var(--ks-fg-muted,#a1a1aa));cursor:pointer;padding:.3rem .1rem;font-size:.68rem}
.ksui-mpp-month:hover{color:var(--ksui-mpp-fg,var(--ks-fg,#ffffff))}
`;

function ensureStyle() { injectCSS(STYLE_ID, CSS); }

function dateParts(now: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    ...(timeZone ? { timeZone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

function dayToken(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function weekStart(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value;
}

function weekToken(year: number, month: number, day: number) {
  const start = weekStart(year, month, day);
  const anchorYear = start.getUTCFullYear();
  const first = weekStart(anchorYear, 1, 1);
  const number = Math.floor((start.getTime() - first.getTime()) / 604800000) + 1;
  return `${anchorYear}-W${String(number).padStart(2, "0")}`;
}

function formatDay(token: string) {
  const [year, month, day] = token.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
  });
}

function formatMonth(token: string) {
  const [year, month] = token.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    timeZone: "UTC", month: "long", year: "numeric",
  });
}

function formatWeek(token: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(token);
  if (!match) return token;
  const start = weekStart(Number(match[1]), 1, 1);
  start.setUTCDate(start.getUTCDate() + (Number(match[2]) - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const format = (date: Date) => date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  return `${format(start)} – ${format(end)}`;
}

function formatToken(granularity: MultiPeriodGranularity, token: string) {
  if (granularity === "day") return formatDay(token);
  if (granularity === "week") return formatWeek(token);
  if (granularity === "month") return formatMonth(token);
  return token;
}

function visibleWeeks(year: number, month: number): MultiPeriodToken[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const cursor = weekStart(year, month, 1);
  const result: MultiPeriodToken[] = [];
  for (let index = 0; index < 6; index += 1) {
    const start = new Date(cursor);
    start.setUTCDate(start.getUTCDate() + index * 7);
    if (start.getUTCFullYear() > year || (start.getUTCFullYear() === year && start.getUTCMonth() + 1 > month)) break;
    if (start.getUTCFullYear() !== year || start.getUTCMonth() + 1 !== month) continue;
    const token = weekToken(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate());
    result.push({ token, label: formatWeek(token) });
  }
  void first;
  return result;
}

function defaultLabel(granularity: MultiPeriodGranularity, labels: MultiPeriodPickerProps["labels"]) {
  return labels?.[granularity] ?? granularity[0].toUpperCase() + granularity.slice(1);
}

export default function MultiPeriodPicker(props: MultiPeriodPickerProps): JSX.Element {
  ensureStyle();
  const now = props.now ?? new Date();
  const current = dateParts(now, props.timeZone);
  const [open, setOpen] = createSignal(false);
  const [viewYear, setViewYear] = createSignal(current.year);
  const [viewMonth, setViewMonth] = createSignal(current.month);
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});
  let triggerRef: HTMLButtonElement | undefined;
  let popupRef: HTMLDivElement | undefined;

  const labels = () => props.labels ?? {};
  const tabOptions: MultiPeriodGranularity[] = ["day", "week", "month", "year"];
  const summary = createMemo(() => {
    if (props.selected.length === 0) return labels().pick ?? "Pick periods";
    if (props.selected.length === 1) return formatToken(props.granularity, props.selected[0]);
    const unit = labels()[props.granularity] ?? props.granularity;
    return `${props.selected.length} ${unit}${props.selected.length === 1 ? "" : "s"}`;
  });

  const toggle = (token: string) => {
    props.onSelectedChange(props.selected.includes(token)
      ? props.selected.filter((value) => value !== token)
      : [...props.selected, token]);
  };
  const tokenContent = (item: MultiPeriodToken) => props.renderToken
    ? props.renderToken({ ...item, selected: props.selected.includes(item.token) })
    : item.label;
  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(viewYear(), viewMonth() - 1 + delta, 1));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth() + 1);
  };
  const updatePosition = () => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    setPopupStyle({ top: `${Math.min(rect.bottom + 4, window.innerHeight - 500)}px`, left: `${Math.min(rect.left, window.innerWidth - 336)}px`, width: "320px", "max-height": "480px" });
  };
  const openPicker = () => { setOpen((value) => !value); queueMicrotask(updatePosition); };

  const days = createMemo<MultiPeriodToken[]>(() => {
    const year = viewYear();
    const month = viewMonth();
    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const result: MultiPeriodToken[] = [];
    for (let offset = firstDow - 1; offset >= 0; offset -= 1) {
      const date = new Date(Date.UTC(year, month - 1, -offset));
      const token = dayToken(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
      result.push({ token, label: String(date.getUTCDate()) });
    }
    for (let day = 1; day <= count; day += 1) result.push({ token: dayToken(year, month, day), label: String(day) });
    return result;
  });
  const monthOptions = createMemo(() => Array.from({ length: 12 }, (_, index) => ({ token: `${viewYear()}-${String(index + 1).padStart(2, "0")}`, label: new Date(Date.UTC(viewYear(), index, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) })));
  const yearOptions = createMemo(() => Array.from({ length: 10 }, (_, index) => { const year = current.year - index; return { token: String(year), label: String(year) }; }));
  const weekOptions = createMemo(() => visibleWeeks(viewYear(), viewMonth()));
  const selectedLabel = (token: string) => formatToken(props.granularity, token);

  return (
    <div class={`ksui-mpp ${props.class ?? ""}`} data-testid="multi-period-picker">
      <div class="ksui-mpp-tabs" role="tablist" aria-label={labels().period ?? "Period"}>
        <For each={tabOptions}>{(granularity) => (
          <button type="button" role="tab" aria-selected={props.granularity === granularity} classList={{ "ksui-mpp-selected": props.granularity === granularity }} class="ksui-mpp-tab" onClick={() => { props.onGranularityChange(granularity); setViewYear(current.year); setViewMonth(current.month); }}>
            {defaultLabel(granularity, labels())}
          </button>
        )}</For>
        <button ref={triggerRef} type="button" class="ksui-mpp-trigger" disabled={props.disabled} aria-haspopup="dialog" aria-expanded={open()} onClick={openPicker}>
          <CalendarDays size={14} aria-hidden="true" /> <span>{summary()}</span><ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      <Show when={open()}>
        <Portal>
          <div ref={popupRef} class="ksui-mpp-popover" style={popupStyle()} role="dialog" aria-label={labels().period ?? "Pick periods"} tabindex={-1}>
            <Show when={props.granularity === "day"}>
              <div class="ksui-mpp-heading"><button class="ksui-mpp-nav" type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft size={14} /></button><span>{new Date(Date.UTC(viewYear(), viewMonth() - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</span><button class="ksui-mpp-nav" type="button" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight size={14} /></button></div>
              <div class="ksui-mpp-grid ksui-mpp-grid-days"><For each={["S", "M", "T", "W", "T", "F", "S"]}>{(label) => <span class="ksui-mpp-token">{label}</span>}</For><For each={days()}>{(item) => <button type="button" classList={{ "ksui-mpp-selected": props.selected.includes(item.token) }} class="ksui-mpp-token" aria-pressed={props.selected.includes(item.token)} onClick={() => toggle(item.token)}>{tokenContent(item)}</button>}</For></div>
            </Show>
            <Show when={props.granularity === "week"}>
              <div class="ksui-mpp-heading"><button class="ksui-mpp-nav" type="button" aria-label="Previous year" onClick={() => setViewYear((year) => year - 1)}><ChevronLeft size={14} /></button><span>{viewYear()}</span><button class="ksui-mpp-nav" type="button" aria-label="Next year" onClick={() => setViewYear((year) => year + 1)}><ChevronRight size={14} /></button></div>
              <div class="ksui-mpp-months"><For each={Array.from({ length: 12 }, (_, index) => index + 1)}>{(month) => <button type="button" class="ksui-mpp-month" classList={{ "ksui-mpp-selected": month === viewMonth() }} onClick={() => setViewMonth(month)}>{new Date(Date.UTC(2000, month - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</button>}</For></div>
              <div class="ksui-mpp-week-label">Weeks</div><div class="ksui-mpp-grid"><For each={weekOptions()}>{(item) => <button type="button" classList={{ "ksui-mpp-selected": props.selected.includes(item.token) }} class="ksui-mpp-token" aria-pressed={props.selected.includes(item.token)} onClick={() => toggle(item.token)}>{tokenContent(item)}</button>}</For></div>
            </Show>
            <Show when={props.granularity === "month"}>
              <div class="ksui-mpp-heading"><button class="ksui-mpp-nav" type="button" aria-label="Previous year" onClick={() => setViewYear((year) => year - 1)}><ChevronLeft size={14} /></button><span>{viewYear()}</span><button class="ksui-mpp-nav" type="button" aria-label="Next year" onClick={() => setViewYear((year) => year + 1)}><ChevronRight size={14} /></button></div>
              <div class="ksui-mpp-grid ksui-mpp-grid-months"><For each={monthOptions()}>{(item) => <button type="button" classList={{ "ksui-mpp-selected": props.selected.includes(item.token) }} class="ksui-mpp-token" aria-pressed={props.selected.includes(item.token)} onClick={() => toggle(item.token)}>{tokenContent(item)}</button>}</For></div>
            </Show>
            <Show when={props.granularity === "year"}><div class="ksui-mpp-grid ksui-mpp-grid-years"><For each={yearOptions()}>{(item) => <button type="button" classList={{ "ksui-mpp-selected": props.selected.includes(item.token) }} class="ksui-mpp-token" aria-pressed={props.selected.includes(item.token)} onClick={() => toggle(item.token)}>{tokenContent(item)}</button>}</For></div></Show>
            <Show when={props.selected.length > 0}><div class="ksui-mpp-chips"><For each={props.selected}>{(token) => <button type="button" class="ksui-mpp-chip ksui-mpp-selected" aria-label={`Remove ${selectedLabel(token)}`} onClick={() => toggle(token)}><span>{selectedLabel(token)}</span><X size={11} aria-hidden="true" /></button>}</For></div></Show>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
