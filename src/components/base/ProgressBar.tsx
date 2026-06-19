// Source: archive/pillar app/pillar-ui/base/ProgressBar/ProgressBar.tsx
// Ported into the library so the counter cards can reuse the same realtime
// progress visualization the session manager uses on the home page.
// Adapted to the library's TS + lucide-solid conventions.

import type { Component, JSX } from "solid-js";
import { createMemo, splitProps, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

// The monolith ships these as a CSS module (ProgressBar.module.css). The
// plugin remote builds to a single IIFE that the host serves as one script —
// a sidecar .css emitted by the lib build would never get injected, so the
// progress fill/indicator/shimmer treatment would silently disappear. Inline
// the keyframes + helper classes once per page via a <style> tag and reference
// them with plain (unscoped) class names so the bundle stays self-contained.
const PROGRESS_STYLE_ID = "ks-progress-bar-inline-style";
const PROGRESS_CSS = `
.ks-progress-fill { position: relative; border-radius: 0; transition: width 1s cubic-bezier(0.4, 0, 0.2, 1); overflow: hidden; }
.ks-progress-indicator { border-radius: 0; box-shadow: 0 0 2px currentColor; }
.ks-progress-overflow { position: relative; }
@keyframes ksLiveTimerShimmer { 0% { transform: translateX(-100%) skewX(-25deg); } 100% { transform: translateX(100%) skewX(-25deg); } }
.ks-progress-shimmer { animation: ksLiveTimerShimmer 2s infinite; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent); background-size: 200% 100%; height: 100%; width: 100%; position: absolute; top: 0; left: 0; opacity: 0.7; }
@media (prefers-reduced-motion: reduce) { .ks-progress-fill { transition: width 0.3s ease; } }
`;
function ensureProgressStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(PROGRESS_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = PROGRESS_STYLE_ID;
  el.textContent = PROGRESS_CSS;
  document.head.appendChild(el);
}
const styles: Record<string, string> = {
  "ks-progress-fill": "ks-progress-fill",
  "ks-progress-indicator": "ks-progress-indicator",
  "ks-progress-overflow": "ks-progress-overflow",
  "animate-shimmer": "ks-progress-shimmer",
};

export interface ProgressBarProps extends JSX.HTMLAttributes<HTMLDivElement> {
  progress: number;
  icon?: Component<{ size: number; class?: string }>;
  label?: string;
  statusLabel?: string;
  shimmer?: boolean;
  position?: "left" | "right";
  hidePercentage?: boolean;
  // When set, this string replaces the percentage on the right side
  // (whether or not `hidePercentage` is true). Lets callers like
  // LiveTimer push the live countdown into the right slot while the
  // total label sits on the left.
  rightLabel?: string;
  class?: string;
}

function cn(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(" ");
}

interface ColorInfo {
  fill: string;
  indicator: string;
  stripe: string;
  overflow: string;
  shimmer: string;
}

const COLOR_MAP: Record<string, ColorInfo> = {
  red: {
    fill: "rgba(255, 68, 68, 0.2)",
    indicator: "#FF4444",
    stripe: "rgba(255, 68, 68, 0.4)",
    overflow: "rgba(255, 68, 68, 0.4)",
    shimmer: "rgba(255, 68, 68, 0.3)",
  },
  green: {
    fill: "rgba(0, 204, 136, 0.2)",
    indicator: "#00CC88",
    stripe: "rgba(0, 204, 136, 0.4)",
    overflow: "rgba(0, 204, 136, 0.4)",
    shimmer: "rgba(0, 204, 136, 0.3)",
  },
  blue: {
    fill: "rgba(74, 158, 255, 0.2)",
    indicator: "#4A9EFF",
    stripe: "rgba(74, 158, 255, 0.4)",
    overflow: "rgba(74, 158, 255, 0.4)",
    shimmer: "rgba(74, 158, 255, 0.3)",
  },
  amber: {
    fill: "rgba(245, 158, 11, 0.2)",
    indicator: "#F59E0B",
    stripe: "rgba(245, 158, 11, 0.4)",
    overflow: "rgba(245, 158, 11, 0.4)",
    shimmer: "rgba(245, 158, 11, 0.3)",
  },
  orange: {
    fill: "rgba(255, 136, 51, 0.2)",
    indicator: "#FF8833",
    stripe: "rgba(255, 136, 51, 0.4)",
    overflow: "rgba(255, 136, 51, 0.4)",
    shimmer: "rgba(255, 136, 51, 0.3)",
  },
  purple: {
    fill: "rgba(168, 85, 247, 0.2)",
    indicator: "#A855F7",
    stripe: "rgba(168, 85, 247, 0.4)",
    overflow: "rgba(168, 85, 247, 0.4)",
    shimmer: "rgba(168, 85, 247, 0.3)",
  },
  slate: {
    fill: "rgba(148, 163, 184, 0.2)",
    indicator: "#94A3B8",
    stripe: "rgba(148, 163, 184, 0.4)",
    overflow: "rgba(148, 163, 184, 0.4)",
    shimmer: "rgba(148, 163, 184, 0.3)",
  },
  gray: {
    fill: "rgba(156, 163, 175, 0.2)",
    indicator: "#9CA3AF",
    stripe: "rgba(156, 163, 175, 0.4)",
    overflow: "rgba(156, 163, 175, 0.4)",
    shimmer: "rgba(156, 163, 175, 0.3)",
  },
  zinc: {
    fill: "rgba(161, 161, 170, 0.2)",
    indicator: "#A1A1AA",
    stripe: "rgba(161, 161, 170, 0.4)",
    overflow: "rgba(161, 161, 170, 0.4)",
    shimmer: "rgba(161, 161, 170, 0.3)",
  },
};

function extractColorInfo(className: string): ColorInfo {
  for (const [name, value] of Object.entries(COLOR_MAP)) {
    if (className.includes(name)) return value;
  }
  return COLOR_MAP.green;
}

function extractTextSize(className: string): number {
  if (className.includes("text-xs")) return 12;
  if (className.includes("text-sm")) return 14;
  if (className.includes("text-base")) return 16;
  if (className.includes("text-lg")) return 18;
  if (className.includes("text-xl")) return 20;
  if (className.includes("text-2xl")) return 24;
  return 14;
}

const ProgressBar: Component<ProgressBarProps> = (props) => {
  ensureProgressStyle();
  const [local, others] = splitProps(props, [
    "progress",
    "icon",
    "label",
    "statusLabel",
    "shimmer",
    "position",
    "hidePercentage",
    "rightLabel",
    "class",
  ]);

  const progressVal = createMemo(() => {
    const value = local.progress;
    if (typeof value !== "number" || Number.isNaN(value)) return 0;
    return Math.max(0, value);
  });

  const position = (): "left" | "right" => local.position ?? "left";
  const shimmer = () => local.shimmer ?? false;
  const statusLabel = () => local.statusLabel;
  const label = () => local.label;
  const hidePercentage = () => local.hidePercentage ?? false;
  const classProp = () => local.class;

  const progressInfo = createMemo(() => {
    const raw = progressVal();
    return { progress: Math.max(0, Math.min(100, raw)), overflow: Math.max(0, raw - 100) };
  });

  const colorInfo = createMemo(() => extractColorInfo(classProp() ?? ""));
  const iconSize = createMemo(() => extractTextSize(classProp() ?? ""));

  const containerClasses = createMemo(() =>
    cn(
      "select-none relative overflow-hidden rounded bg-black/20 border border-zinc-700/40",
      "h-8",
      !classProp()?.includes("w-") ? "w-full" : "",
      classProp(),
    ),
  );

  const progressStyle = createMemo(() => {
    const colors = colorInfo();
    const { progress } = progressInfo();
    const isRight = position() === "right";
    const style: Record<string, string | number> = {
      width: `${progress}%`,
      "background-color": colors.fill,
    };
    if (isRight) {
      style.position = "absolute";
      style.right = "0px";
      style["border-radius"] = "0 4px 4px 0";
    }
    return style;
  });

  const overflowStyle = createMemo(() => {
    const colors = colorInfo();
    const { overflow } = progressInfo();
    const isRight = position() === "right";
    const visible = Math.min(90, overflow);
    if (isRight) {
      return {
        width: `${visible}%`,
        "background-color": colors.overflow,
        position: "absolute" as const,
        left: "0px",
        top: "0px",
        height: "100%",
        "border-radius": "4px 0 0 4px",
      };
    }
    const startPosition = Math.max(10, 100 - visible);
    return {
      width: `${visible}%`,
      "background-color": colors.overflow,
      position: "absolute" as const,
      left: `${startPosition}%`,
      top: "0px",
      height: "100%",
      "border-radius": "0 4px 4px 0",
    };
  });

  const indicatorStyle = createMemo(() => {
    const colors = colorInfo();
    const isRight = position() === "right";
    return {
      "background-color": colors.indicator,
      ...(isRight ? { left: "0px" } : { right: "0px" }),
    };
  });

  const overflowIndicatorStyle = createMemo(() => {
    const colors = colorInfo();
    const isRight = position() === "right";
    return {
      "background-color": colors.indicator,
      ...(isRight ? { right: "0px" } : { left: "0px" }),
    };
  });

  const shimmerStyle = createMemo(() => ({
    background: `linear-gradient(90deg, transparent, ${colorInfo().shimmer}, transparent)`,
  }));

  const Icon = () => local.icon;

  return (
    <div class={containerClasses()} {...others}>
      <div
        class={cn("h-full transition-all duration-1000 relative", styles["ks-progress-fill"])}
        style={progressStyle()}
      >
        {shimmer() && progressInfo().overflow <= 0 && (
          <div class={cn("absolute inset-0", styles["animate-shimmer"])} style={shimmerStyle()} />
        )}
        {progressInfo().overflow <= 0 && (
          <div
            class={cn("absolute top-0 w-1 h-full animate-pulse", styles["ks-progress-indicator"])}
            style={indicatorStyle()}
          />
        )}
      </div>
      {progressInfo().overflow > 0 && (
        <div
          class={cn("transition-all duration-1000 animate-pulse", styles["ks-progress-overflow"])}
          style={overflowStyle()}
        >
          <div
            class={cn("absolute top-0 w-1 h-full animate-pulse", styles["ks-progress-indicator"])}
            style={overflowIndicatorStyle()}
          />
        </div>
      )}
      <div class="absolute inset-0 flex items-center justify-between px-3">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          {(() => {
            const I = Icon();
            return (
              <Show when={I}>
                <Dynamic component={I!} size={iconSize()} />
              </Show>
            );
          })()}
          {statusLabel() && (
            <span class="font-mono font-semibold tabular-nums">{statusLabel()}</span>
          )}
          {label() && (
            <>
              {(Icon() || statusLabel()) && <span class="text-zinc-500 mx-1">·</span>}
              <span class="flex-1 min-w-0">
                <span class="text-zinc-400 block overflow-hidden text-ellipsis whitespace-nowrap">
                  {label()}
                </span>
              </span>
            </>
          )}
        </div>
        {local.rightLabel !== undefined ? (
          <div class="flex-shrink-0 ml-2 text-right">
            <span class="font-mono font-semibold tabular-nums">{local.rightLabel}</span>
          </div>
        ) : !hidePercentage() ? (
          <div class="flex-shrink-0 ml-2 text-right">
            <span class="font-mono font-medium text-zinc-400">{Math.round(progressVal())}%</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ProgressBar;
