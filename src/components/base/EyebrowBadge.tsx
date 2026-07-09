import { Show, type JSX } from "solid-js";

export type EyebrowTone = "amber" | "blue" | "emerald" | "red" | "zinc";

interface ToneClass {
  /** Text color for the kicker label. */
  text: string;
  /** Tinted background, used by the bordered pill variant. */
  bg: string;
  /** Accent border color, used by the bordered pill variant. */
  border: string;
}

// Module-private tone palette. The caller picks a tone; nothing
// domain-specific leaks into this atom. Each tone is a flat color family so
// the badge reads as a quiet accent rather than a loud chip.
const TONE_CLASS: Record<EyebrowTone, ToneClass> = {
  amber: {
    text: "text-[var(--ks-accent,#fbbf24)]",
    bg: "bg-[var(--ks-warning-bg,rgba(245,158,11,0.12))]",
    border: "border-[var(--ks-warning,#f59e0b)]",
  },
  blue: {
    text: "text-[var(--ks-info-fg,#7dd3fc)]",
    bg: "bg-[var(--ks-info-bg,rgba(56,189,248,0.12))]",
    border: "border-[var(--ks-info,#38bdf8)]",
  },
  emerald: {
    text: "text-[var(--ks-success-fg,#34d399)]",
    bg: "bg-[var(--ks-success-bg,rgba(16,185,129,0.12))]",
    border: "border-[var(--ks-success,#10b981)]",
  },
  red: {
    text: "text-[var(--ks-danger-fg,#f87171)]",
    bg: "bg-[var(--ks-danger-bg,rgba(239,68,68,0.12))]",
    border: "border-[var(--ks-danger,#ef4444)]",
  },
  zinc: {
    text: "text-[var(--ks-fg-subtle,#71717a)]",
    bg: "bg-[var(--ks-border,rgba(39,39,42,0.5))]",
    border: "border-[var(--ks-border-strong,#3f3f46)]",
  },
};

// Tracking presets for the wide letter-spacing. "normal" is Tailwind's
// tracking-widest; the wider presets cover the heading kickers that use
// arbitrary tracking values.
const TRACKING_CLASS = {
  normal: "tracking-widest",
  wide: "tracking-[0.2em]",
  wider: "tracking-[0.3em]",
} as const;

export type EyebrowTracking = keyof typeof TRACKING_CLASS;

export interface EyebrowBadgeProps {
  /** The kicker text. Rendered uppercase via CSS, so pass natural casing. */
  label: string;
  /** Color family for the label (and the accent border when bordered). */
  tone?: EyebrowTone;
  /**
   * Render the bordered pill variant: a tinted background with a left accent
   * border (the hero-style kicker). When false (default) it is a plain
   * tracked-text kicker with no box.
   */
  bordered?: boolean;
  /** Letter-spacing preset. */
  tracking?: EyebrowTracking;
  /** Render as an inline-block <div> instead of an inline <span>. */
  block?: boolean;
  /** Extra classes on the wrapper. */
  class?: string;
  testId?: string;
}

// A tiny, domain-free eyebrow / kicker atom: an uppercase, wide-tracked,
// bold micro-label. The plain variant is just tracked text; the bordered
// variant wraps it in a tinted pill with a left accent border. Presentational
// only — the caller supplies the label and picks a tone.
export default function EyebrowBadge(props: EyebrowBadgeProps): JSX.Element {
  const tc = () => TONE_CLASS[props.tone ?? "amber"];
  const tracking = () => TRACKING_CLASS[props.tracking ?? "normal"];

  const base = () =>
    `text-xs font-bold uppercase ${tracking()} ${tc().text}`;
  const borderedExtra = () =>
    props.bordered
      ? `inline-block px-4 py-1 border-l-2 ${tc().bg} ${tc().border}`
      : "";

  const className = () =>
    `${base()} ${borderedExtra()} ${props.class ?? ""}`.trim();

  return (
    <Show
      when={props.block || props.bordered}
      fallback={
        <span data-testid={props.testId} class={className()}>
          {props.label}
        </span>
      }
    >
      <div data-testid={props.testId} class={`inline-block ${className()}`}>
        {props.label}
      </div>
    </Show>
  );
}
