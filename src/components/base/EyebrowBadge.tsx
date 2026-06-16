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
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500",
  },
  blue: {
    text: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500",
  },
  emerald: {
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500",
  },
  red: {
    text: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500",
  },
  zinc: {
    text: "text-zinc-500",
    bg: "bg-zinc-800/50",
    border: "border-zinc-600",
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
