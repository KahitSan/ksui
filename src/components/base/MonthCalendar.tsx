import { For, createMemo, createUniqueId, type JSX } from "solid-js";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { injectCSS } from "../../utils/inject-css";
import {
  addCivilMonths,
  buildMonthCalendarDays,
  formatCivilDate,
  requireCivilDate,
  todayInTimeZone,
  type MonthCalendarDay,
} from "../../utils/month-calendar-date";

const STYLE_ID = "ksui-month-calendar-style";
const MONTH_CALENDAR_CSS = `
.ksui-month-calendar{color:var(--ksui-month-calendar-fg,var(--ks-fg,#ffffff));font-family:var(--ksui-month-calendar-font,var(--ks-font-body,"Inter", system-ui, sans-serif));}
.ksui-month-calendar__nav{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:.75rem;}
.ksui-month-calendar__nav-group{display:flex;align-items:center;gap:.25rem;min-width:0;}
.ksui-month-calendar__heading{margin:0 .25rem;font-size:.875rem;line-height:1.25rem;font-weight:600;white-space:nowrap;}
.ksui-month-calendar__button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:.375rem;background:transparent;color:var(--ksui-month-calendar-muted,var(--ks-fg-muted,#a1a1aa));cursor:pointer;transition:background-color .15s ease,color .15s ease;}
.ksui-month-calendar__button:hover{background:var(--ksui-month-calendar-hover,var(--ks-surface-raised,#1a1a1a));color:var(--ksui-month-calendar-fg,var(--ks-fg,#ffffff));}
.ksui-month-calendar__button:focus-visible{outline:2px solid var(--ksui-month-calendar-focus,var(--ks-focus-ring,#c9a961));outline-offset:2px;}
.ksui-month-calendar__nav-button{width:2rem;height:2rem;padding:0;}
.ksui-month-calendar__today-button{padding:.375rem .625rem;font-size:.75rem;line-height:1rem;font-weight:500;}
.ksui-month-calendar__grid{overflow:hidden;border:1px solid var(--ksui-month-calendar-border,var(--ks-border,rgba(39,39,42,0.5)));border-radius:.5rem;background:var(--ksui-month-calendar-gap,var(--ks-border,rgba(39,39,42,0.5)));}
.ksui-month-calendar__header,.ksui-month-calendar__week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;}
.ksui-month-calendar__columnheader{padding:.5rem .25rem;background:var(--ksui-month-calendar-surface,var(--ks-surface,#0f0f0f));color:var(--ksui-month-calendar-subtle,var(--ks-fg-subtle,#71717a));font-size:.6875rem;line-height:1rem;font-weight:600;text-align:center;text-transform:uppercase;letter-spacing:.05em;}
.ksui-month-calendar__cell{min-width:0;min-height:5rem;background:var(--ksui-month-calendar-surface,var(--ks-surface,#0f0f0f));}
.ksui-month-calendar__cell--outside{color:var(--ksui-month-calendar-subtle,var(--ks-fg-subtle,#71717a));}
.ksui-month-calendar__cell--hidden{visibility:hidden;}
.ksui-month-calendar__day-label{display:inline-flex;align-items:center;justify-content:center;min-width:1.5rem;height:1.5rem;margin:.25rem;padding:0 .25rem;border-radius:9999px;color:var(--ksui-month-calendar-muted,var(--ks-fg-muted,#a1a1aa));font-size:.75rem;line-height:1rem;font-variant-numeric:tabular-nums;}
.ksui-month-calendar__cell[aria-current="date"] .ksui-month-calendar__day-label{background:var(--ksui-month-calendar-today-bg,color-mix(in srgb,var(--ks-primary,#c9a961) 20%,transparent));color:var(--ksui-month-calendar-today-fg,var(--ks-accent,#fbbf24));font-weight:600;}
`;

export interface MonthCalendarDayRenderProps extends MonthCalendarDay {
  dayLabelId: string;
}

export interface MonthCalendarWeekRenderProps {
  weekIndex: number;
  days: readonly MonthCalendarDayRenderProps[];
  children: () => JSX.Element;
}

export interface MonthCalendarLabels {
  previousMonth?: string;
  nextMonth?: string;
  today?: string;
}

export interface MonthCalendarClasses {
  root?: string;
  nav?: string;
  heading?: string;
  grid?: string;
  header?: string;
  columnHeader?: string;
  week?: string;
  cell?: string;
  dayLabel?: string;
  previousButton?: string;
  nextButton?: string;
  todayButton?: string;
}

export interface MonthCalendarProps {
  month: string;
  onMonthChange: (month: string) => void;
  renderDay: (props: MonthCalendarDayRenderProps) => JSX.Element;
  renderWeek?: (props: MonthCalendarWeekRenderProps) => JSX.Element;
  today?: string;
  timeZone?: string;
  locale?: string;
  weekStartsOn?: number;
  showOutsideDays?: boolean;
  showTodayButton?: boolean;
  labels?: MonthCalendarLabels;
  classes?: MonthCalendarClasses;
}

interface ResolvedLabels {
  previousMonth: string;
  nextMonth: string;
  today: string;
}

function resolveLabels(labels?: MonthCalendarLabels): ResolvedLabels {
  return {
    previousMonth: labels?.previousMonth ?? "Previous month",
    nextMonth: labels?.nextMonth ?? "Next month",
    today: labels?.today ?? "Today",
  };
}

function resolveClasses(classes?: MonthCalendarClasses): MonthCalendarClasses {
  return classes ?? {};
}

function joinClasses(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}


function displayDate(day: MonthCalendarDay, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(day.year, day.month - 1, day.day)));
}

interface DayCellProps {
  day: MonthCalendarDayRenderProps;
  locale: string;
  showOutsideDays: boolean;
  cellClass?: string;
  dayLabelClass?: string;
  renderDay: MonthCalendarProps["renderDay"];
}

function DayCell(props: DayCellProps) {
  const hidden = () => !props.day.inMonth && !props.showOutsideDays;
  return (
    <div
      role="gridcell"
      aria-current={props.day.isToday ? "date" : undefined}
      aria-labelledby={hidden() ? undefined : props.day.dayLabelId}
      aria-hidden={hidden() ? "true" : undefined}
      class={joinClasses(
        "ksui-month-calendar__cell",
        !props.day.inMonth ? "ksui-month-calendar__cell--outside" : undefined,
        hidden() ? "ksui-month-calendar__cell--hidden" : undefined,
        props.cellClass,
      )}
    >
      {!hidden() && (
        <>
          <span
            id={props.day.dayLabelId}
            class={joinClasses("ksui-month-calendar__day-label", props.dayLabelClass)}
            aria-label={displayDate(props.day, props.locale)}
          >
            {props.day.day}
          </span>
          {props.renderDay(props.day)}
        </>
      )}
    </div>
  );
}

interface CalendarGridProps {
  headingId: string;
  weekdayLabels: readonly string[];
  weeks: readonly (readonly MonthCalendarDayRenderProps[])[];
  locale: string;
  showOutsideDays: boolean;
  classes?: MonthCalendarClasses;
  renderDay: MonthCalendarProps["renderDay"];
  renderWeek?: MonthCalendarProps["renderWeek"];
}

interface CalendarNavigationProps {
  heading: string;
  headingId: string;
  showTodayButton: boolean;
  previousLabel: string;
  nextLabel: string;
  todayLabel: string;
  navClass?: string;
  headingClass?: string;
  previousButtonClass?: string;
  nextButtonClass?: string;
  todayButtonClass?: string;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
}

interface NavigationIconButtonProps {
  label: string;
  class?: string;
  direction: "previous" | "next";
  onClick: () => void;
}

function NavigationIconButton(props: NavigationIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={props.label}
      class={joinClasses("ksui-month-calendar__button ksui-month-calendar__nav-button", props.class)}
      onClick={props.onClick}
    >
      {props.direction === "previous"
        ? <ChevronLeft size={16} aria-hidden="true" />
        : <ChevronRight size={16} aria-hidden="true" />}
    </button>
  );
}

interface TodayButtonProps {
  visible: boolean;
  label: string;
  class?: string;
  onClick: () => void;
}

function TodayButton(props: TodayButtonProps) {
  return props.visible ? (
    <button
      type="button"
      class={joinClasses("ksui-month-calendar__button ksui-month-calendar__today-button", props.class)}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  ) : null;
}

function CalendarNavigation(props: CalendarNavigationProps) {
  return (
    <nav aria-label={props.heading} class={joinClasses("ksui-month-calendar__nav", props.navClass)}>
      <div class="ksui-month-calendar__nav-group">
        <NavigationIconButton
          label={props.previousLabel}
          class={props.previousButtonClass}
          direction="previous"
          onClick={props.onPreviousMonth}
        />
        <h2 id={props.headingId} class={joinClasses("ksui-month-calendar__heading", props.headingClass)}>
          {props.heading}
        </h2>
        <NavigationIconButton
          label={props.nextLabel}
          class={props.nextButtonClass}
          direction="next"
          onClick={props.onNextMonth}
        />
      </div>
      <TodayButton
        visible={props.showTodayButton}
        label={props.todayLabel}
        class={props.todayButtonClass}
        onClick={props.onToday}
      />
    </nav>
  );
}

interface MonthCalendarModel {
  headingId: string;
  heading: () => string;
  locale: () => string;
  showOutsideDays: () => boolean;
  showTodayButton: () => boolean;
  weekdayLabels: () => string[];
  weeks: () => MonthCalendarDayRenderProps[][];
  previousMonth: () => void;
  nextMonth: () => void;
  goToToday: () => void;
}

function createMonthCalendarModel(props: MonthCalendarProps): MonthCalendarModel {
  const id = createUniqueId();
  const locale = () => props.locale ?? "en-US";
  const timeZone = () => props.timeZone ?? "UTC";
  const weekStartsOn = () => props.weekStartsOn ?? 0;
  const showOutsideDays = () => props.showOutsideDays ?? true;
  const showTodayButton = () => props.showTodayButton ?? true;
  const today = createMemo(() => props.today ?? formatCivilDate(todayInTimeZone(timeZone())));
  const month = createMemo(() => requireCivilDate(props.month, "month"));
  const monthStart = createMemo(() => ({ ...month(), day: 1 }));
  const headingId = `${id}-heading`;
  const heading = createMemo(() =>
    new Intl.DateTimeFormat(locale(), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(month().year, month().month - 1, 1))),
  );
  const weekdayLabels = createMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale(), { weekday: "short", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, index) => {
      const weekday = (weekStartsOn() + index) % 7;
      return formatter.format(new Date(Date.UTC(2024, 0, 7 + weekday)));
    });
  });
  const weeks = createMemo(() => {
    const days = buildMonthCalendarDays(props.month, today(), weekStartsOn());
    return Array.from({ length: 6 }, (_, weekIndex) =>
      days.slice(weekIndex * 7, weekIndex * 7 + 7).map((day) => ({
        ...day,
        dayLabelId: `${id}-day-${day.date}`,
      })),
    );
  });
  const changeMonth = (offset: number) => {
    props.onMonthChange(formatCivilDate(addCivilMonths(monthStart(), offset)));
  };
  const goToToday = () => {
    const value = requireCivilDate(today(), "today");
    props.onMonthChange(formatCivilDate({ ...value, day: 1 }));
  };
  return {
    headingId,
    heading,
    locale,
    showOutsideDays,
    showTodayButton,
    weekdayLabels,
    weeks,
    previousMonth: () => changeMonth(-1),
    nextMonth: () => changeMonth(1),
    goToToday,
  };
}

function CalendarGrid(props: CalendarGridProps) {
  const cells = (days: readonly MonthCalendarDayRenderProps[]) => (
    <For each={days}>
      {(day) => (
        <DayCell
          day={day}
          locale={props.locale}
          showOutsideDays={props.showOutsideDays}
          cellClass={props.classes?.cell}
          dayLabelClass={props.classes?.dayLabel}
          renderDay={props.renderDay}
        />
      )}
    </For>
  );

  return (
    <div role="grid" aria-labelledby={props.headingId} class={joinClasses("ksui-month-calendar__grid", props.classes?.grid)}>
      <div role="row" class={joinClasses("ksui-month-calendar__header", props.classes?.header)}>
        <For each={props.weekdayLabels}>
          {(label) => (
            <div role="columnheader" class={joinClasses("ksui-month-calendar__columnheader", props.classes?.columnHeader)}>
              {label}
            </div>
          )}
        </For>
      </div>
      <For each={props.weeks}>
        {(days, weekIndex) => {
          const children = () => cells(days);
          return (
            <div role="row" class={joinClasses("ksui-month-calendar__week", props.classes?.week)}>
              {props.renderWeek
                ? props.renderWeek({ weekIndex: weekIndex(), days, children })
                : children()}
            </div>
          );
        }}
      </For>
    </div>
  );
}

export default function MonthCalendar(props: MonthCalendarProps) {
  injectCSS(STYLE_ID, MONTH_CALENDAR_CSS);
  const model = createMonthCalendarModel(props);
  const labels = () => resolveLabels(props.labels);
  const classes = () => resolveClasses(props.classes);
  return (
    <section
      aria-labelledby={model.headingId}
      class={joinClasses("ksui-month-calendar", classes().root)}
    >
      <CalendarNavigation
        heading={model.heading()}
        headingId={model.headingId}
        showTodayButton={model.showTodayButton()}
        previousLabel={labels().previousMonth}
        nextLabel={labels().nextMonth}
        todayLabel={labels().today}
        navClass={classes().nav}
        headingClass={classes().heading}
        previousButtonClass={classes().previousButton}
        nextButtonClass={classes().nextButton}
        todayButtonClass={classes().todayButton}
        onPreviousMonth={model.previousMonth}
        onNextMonth={model.nextMonth}
        onToday={model.goToToday}
      />
      <CalendarGrid
        headingId={model.headingId}
        weekdayLabels={model.weekdayLabels()}
        weeks={model.weeks()}
        locale={model.locale()}
        showOutsideDays={model.showOutsideDays()}
        classes={classes()}
        renderDay={props.renderDay}
        renderWeek={props.renderWeek}
      />
    </section>
  );
}
