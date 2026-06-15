// Source: archive/pillar app/pillar-ui/composite/LiveTimer/LiveTimer.tsx
// Reusable realtime / overdue progress display. The ticker module-state
// is shared across all LiveTimer instances on the page so we don't run
// N intervals when N cards are on screen — the home page session
// manager already proved this pattern at scale, so we lift it as-is.

import type { Component, JSX } from "solid-js";
import { Show, createMemo, createSignal, onCleanup, splitProps } from "solid-js";
import Clock from "lucide-solid/icons/clock";
import Play from "lucide-solid/icons/play";
import AlertTriangle from "lucide-solid/icons/triangle-alert";
import Check from "lucide-solid/icons/check";
import Calendar from "lucide-solid/icons/calendar";
import ProgressBar from "./ProgressBar";

export interface LiveTimerProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "class"> {
  // Core timing
  startAt: Date | string | number;
  endAt?: Date | string | number | null;
  // When true, the timer keeps counting past `endAt` (red overdue
  // visualization) instead of switching to the completed look.
  overdue?: boolean;
  // Optional icon override; default picks one based on scenario.
  icon?: Component<{ size: number; class?: string }>;
  // Optional class merged onto the underlying ProgressBar.
  class?: string;
  // Overrides the scenario's default right-side label (e.g. swap the
  // built-in "Remaining" for a total-duration label like "9h").
  // `null` hides the label entirely.
  label?: string | null;
  // Force-hide the percentage readout regardless of scenario default.
  // Counter pills don't surface percentages; the home page might.
  hidePercentage?: boolean;
  // When set, swaps the pill layout to total-left / countdown-right:
  //   [icon] {totalLabel}                                 {countdown}
  // Caller-provided string sits on the LEFT next to the icon; the live
  // countdown moves to the RIGHT where the percentage used to sit.
  // Counter cards use this so cashiers see "4h total" + "5h 23:45" on
  // one row without ellipsis.
  totalLabel?: string;
}

// Dynamic tick — 1s under 24h remaining, 5min over. Shared module-state
// so the page runs at most ONE interval no matter how many LiveTimers
// are mounted.
let dynamicTickSignal: (() => number) | null = null;
let dynamicIntervalId: ReturnType<typeof setInterval> | null = null;
let dynamicSubscriberCount = 0;
let currentInterval = 1000;

function getDynamicTick(startSec: number, endSec: number | null, overdue: boolean): () => number {
  if (!dynamicTickSignal) {
    const [tick, setTick] = createSignal(Date.now());
    dynamicTickSignal = tick;

    const updateInterval = () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const HOURS_24 = 24 * 3600;
      let newInterval = 1000;
      if (nowSec <= startSec) {
        const rem = startSec - nowSec;
        newInterval = rem > HOURS_24 ? 300000 : 1000;
      } else if (endSec !== null && nowSec < endSec) {
        const rem = endSec - nowSec;
        newInterval = rem > HOURS_24 ? 300000 : 1000;
      } else if (endSec !== null && nowSec >= endSec && overdue) {
        const od = nowSec - endSec;
        newInterval = od > HOURS_24 ? 300000 : 1000;
      }
      if (newInterval !== currentInterval) {
        currentInterval = newInterval;
        if (dynamicIntervalId) clearInterval(dynamicIntervalId);
        dynamicIntervalId = setInterval(() => {
          setTick(Date.now());
          updateInterval();
        }, currentInterval);
      }
    };

    dynamicIntervalId = setInterval(() => {
      setTick(Date.now());
      updateInterval();
    }, currentInterval);
  }

  dynamicSubscriberCount++;

  onCleanup(() => {
    dynamicSubscriberCount--;
    if (dynamicSubscriberCount === 0 && dynamicIntervalId) {
      clearInterval(dynamicIntervalId);
      dynamicIntervalId = null;
      dynamicTickSignal = null;
      currentInterval = 1000;
    }
  });

  return dynamicTickSignal;
}

// Slow tick — 10s, for heavy calculations (progress + scenario) that
// don't need second-level accuracy.
let slowTickSignal: (() => number) | null = null;
let slowIntervalId: ReturnType<typeof setInterval> | null = null;
let slowSubscriberCount = 0;

function getSlowTick(): () => number {
  if (!slowTickSignal) {
    const [tick, setTick] = createSignal(Date.now());
    slowTickSignal = tick;
    slowIntervalId = setInterval(() => setTick(Date.now()), 10000);
  }
  slowSubscriberCount++;
  onCleanup(() => {
    slowSubscriberCount--;
    if (slowSubscriberCount === 0 && slowIntervalId) {
      clearInterval(slowIntervalId);
      slowIntervalId = null;
      slowTickSignal = null;
    }
  });
  return slowTickSignal;
}

function ensureDate(value: Date | string | number | null | undefined): Date | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return undefined;
    return d;
  } catch {
    return undefined;
  }
}

const PAD = ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09"];
function pad2(n: number): string {
  return n < 10 ? PAD[n] : String(n);
}

// Compact countdown / elapsed format. Spec from the counter cards:
//   * >= 1 day  → "Xd Yh"           (seconds aren't worth watching at this scale)
//   * >= 1 hour → "Xh MM:SS"        (mixed unit, mm:ss keeps it readable)
//   * < 1 hour  → "MM:SS"           (compact urgency)
// Returns "0:00" for negatives so an overdue render that briefly hits 0
// doesn't blink to "-1:..".
function formatLiveTimer(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "00:00";
  const HOURS_24 = 24 * 3600;
  if (totalSeconds >= HOURS_24) {
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    return `${d}d ${h}h`;
  }
  if (totalSeconds >= 3600) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${h}h ${pad2(m)}:${pad2(s)}`;
  }
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${pad2(m)}:${pad2(s)}`;
}

// Back-compat alias for any caller still expecting the older name.
function formatTimeWithDays(totalSeconds: number): string {
  return formatLiveTimer(totalSeconds);
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const SCENARIO_COUNTDOWN_TO_START = 0;
const SCENARIO_OPEN_TIMER = 1;
const SCENARIO_OVERDUE = 2;
const SCENARIO_COMPLETED = 3;
const SCENARIO_COUNTDOWN_TIMER = 4;
type Scenario =
  | typeof SCENARIO_COUNTDOWN_TO_START
  | typeof SCENARIO_OPEN_TIMER
  | typeof SCENARIO_OVERDUE
  | typeof SCENARIO_COMPLETED
  | typeof SCENARIO_COUNTDOWN_TIMER;

interface ScenarioConfig {
  position: "left" | "right";
  colorClass: string;
  label: string | undefined;
  hidePercentage: boolean;
  shimmer: boolean;
}

const SCENARIO_CONFIGS: Record<Scenario, ScenarioConfig> = {
  [SCENARIO_COUNTDOWN_TO_START]: {
    position: "right",
    colorClass: "border border-blue-600/60 text-blue-400 hover:border-blue-500",
    // Active board card uses this to read "[icon] 4h total · Starts in
    // <countdown>" so the cashier sees both the package total and that
    // the rental is a future booking, not an in-progress one.
    label: "Starts in",
    hidePercentage: true,
    shimmer: false,
  },
  [SCENARIO_OPEN_TIMER]: {
    position: "left",
    colorClass: "border border-green-600/60 text-green-400 hover:border-green-500",
    label: "Open time",
    hidePercentage: true,
    shimmer: true,
  },
  [SCENARIO_OVERDUE]: {
    position: "left",
    colorClass: "border border-purple-600/60 text-purple-400 hover:border-purple-500",
    label: "Overdue",
    hidePercentage: false,
    shimmer: false,
  },
  [SCENARIO_COMPLETED]: {
    position: "left",
    colorClass: "border border-zinc-600/60 text-zinc-400 hover:border-zinc-500",
    label: "Completed",
    hidePercentage: false,
    shimmer: false,
  },
  [SCENARIO_COUNTDOWN_TIMER]: {
    position: "left",
    colorClass: "",
    label: "Remaining",
    hidePercentage: false,
    shimmer: false,
  },
};

const COLOR_GREEN = "border border-green-600/60 text-green-400 hover:border-green-500";
const COLOR_AMBER = "border border-amber-600/60 text-amber-400 hover:border-amber-500";
const COLOR_RED = "border border-red-600/60 text-red-400 hover:border-red-500";

const LiveTimer: Component<LiveTimerProps> = (props) => {
  const [local, others] = splitProps(props, [
    "startAt",
    "endAt",
    "overdue",
    "icon",
    "class",
    "label",
    "hidePercentage",
    "totalLabel",
  ]);

  const timestamps = createMemo(() => {
    const start = ensureDate(local.startAt);
    if (!start) throw new Error("LiveTimer: startAt must be a valid Date or date string");
    const end = ensureDate(local.endAt ?? null);
    return {
      startSec: Math.floor(start.getTime() / 1000),
      endSec: end ? Math.floor(end.getTime() / 1000) : null,
    };
  });

  // Subscribe to the shared tickers.
  const { startSec, endSec } = timestamps();
  const dynamicTick = getDynamicTick(startSec, endSec, local.overdue ?? false);
  const slowTick = getSlowTick();

  const scenario = createMemo<Scenario>(() => {
    const nowSec = Math.floor(slowTick() / 1000);
    const { startSec: s, endSec: e } = timestamps();
    if (nowSec <= s) return SCENARIO_COUNTDOWN_TO_START;
    if (e === null) return SCENARIO_OPEN_TIMER;
    const done = nowSec >= e;
    if (done && local.overdue) return SCENARIO_OVERDUE;
    if (done) return SCENARIO_COMPLETED;
    return SCENARIO_COUNTDOWN_TIMER;
  });

  const progress = createMemo(() => {
    const nowSec = Math.floor(slowTick() / 1000);
    const { startSec: s, endSec: e } = timestamps();
    switch (scenario()) {
      case SCENARIO_COUNTDOWN_TO_START: {
        const rem = s - nowSec;
        return Math.min(100, (rem / 3600) * 100);
      }
      case SCENARIO_OPEN_TIMER:
        return 95;
      case SCENARIO_OVERDUE: {
        const od = nowSec - (e ?? nowSec);
        const total = (e ?? 0) - s;
        const pct = total > 0 ? (od / total) * 100 : 0;
        return 100 + pct;
      }
      case SCENARIO_COMPLETED:
        return 100;
      case SCENARIO_COUNTDOWN_TIMER: {
        const rem = (e ?? nowSec) - nowSec;
        const total = (e ?? 0) - s;
        const elapsed = total - rem;
        return total > 0 ? Math.min(100, (elapsed / total) * 100) : 100;
      }
      default:
        return 0;
    }
  });

  const statusLabel = createMemo(() => {
    const nowSec = Math.floor(dynamicTick() / 1000);
    const { startSec: s, endSec: e } = timestamps();
    switch (scenario()) {
      case SCENARIO_COUNTDOWN_TO_START:
        return formatTimeWithDays(s - nowSec);
      case SCENARIO_OPEN_TIMER:
        return formatTimeWithDays(nowSec - s);
      case SCENARIO_OVERDUE:
        return formatTimeWithDays(nowSec - (e ?? nowSec));
      case SCENARIO_COMPLETED:
        return formatDuration((e ?? 0) - s);
      case SCENARIO_COUNTDOWN_TIMER:
        return formatTimeWithDays((e ?? nowSec) - nowSec);
      default:
        return "00:00:00";
    }
  });

  const staticConfig = createMemo(() => SCENARIO_CONFIGS[scenario()]);

  const icon = createMemo<Component<{ size: number; class?: string }>>(() => {
    if (local.icon) return local.icon;
    switch (scenario()) {
      case SCENARIO_COUNTDOWN_TO_START:
        return Calendar;
      case SCENARIO_OPEN_TIMER:
        return Play;
      case SCENARIO_OVERDUE:
        return AlertTriangle;
      case SCENARIO_COMPLETED:
        return Check;
      case SCENARIO_COUNTDOWN_TIMER:
      default:
        return Clock;
    }
  });

  const colorClass = createMemo(() => {
    if (scenario() === SCENARIO_COUNTDOWN_TIMER) {
      const p = progress();
      return p <= 25 ? COLOR_GREEN : p <= 75 ? COLOR_AMBER : COLOR_RED;
    }
    return staticConfig().colorClass;
  });

  const finalClass = createMemo(() => {
    const user = local.class ?? "";
    if (user.includes("border-") && user.includes("text-")) return user;
    return `${colorClass()} ${user}`.trim();
  });

  const resolvedLabel = createMemo(() => {
    // `null` is the explicit "no label" signal from the caller; an
    // undefined `local.label` falls through to the scenario default
    // ("Remaining" etc.).
    if (local.label === null) return undefined;
    if (local.label !== undefined) return local.label;
    return staticConfig().label;
  });

  const resolvedHidePercentage = createMemo(() => {
    return local.hidePercentage ?? staticConfig().hidePercentage;
  });

  // Scenario context label sits after the totalLabel on the left so the
  // cashier sees "[icon] 4h total · Starts in" / "… · Overdue" without
  // hiding the countdown. Running countdowns (the common case) skip it
  // — the right-side ticker already carries the time-remaining cue.
  const scenarioContextLabel = createMemo(() => {
    switch (scenario()) {
      case SCENARIO_COUNTDOWN_TO_START:
        return "Starts in";
      case SCENARIO_OVERDUE:
        return "Overdue";
      case SCENARIO_OPEN_TIMER:
        return "Open";
      default:
        return undefined;
    }
  });

  // Layout mode A — caller passed `totalLabel`. Show the total label on
  // the left and the live countdown on the right. No secondary label,
  // no percentage. This is what the counter cards use so cashiers read
  // "4h total" + "5h 23:45" without competing text.
  // Layout mode B — default. statusLabel carries the countdown on the
  // left, scenario label sits after it, percentage renders on the
  // right (unless `hidePercentage`). Matches the home page session
  // manager's original look.
  return (
    <Show
      when={local.totalLabel !== undefined}
      fallback={
        <ProgressBar
          progress={progress()}
          icon={icon()}
          statusLabel={statusLabel()}
          label={resolvedLabel()}
          position={staticConfig().position}
          hidePercentage={resolvedHidePercentage()}
          shimmer={staticConfig().shimmer}
          class={finalClass()}
          {...others}
        />
      }
    >
      <ProgressBar
        progress={progress()}
        icon={icon()}
        statusLabel={local.totalLabel}
        label={scenarioContextLabel()}
        position={staticConfig().position}
        hidePercentage
        rightLabel={statusLabel()}
        shimmer={staticConfig().shimmer}
        class={finalClass()}
        {...others}
      />
    </Show>
  );
};

export default LiveTimer;
