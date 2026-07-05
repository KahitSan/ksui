import { type JSX } from "solid-js";

export type StatusTone = "success" | "neutral" | "warning" | "danger" | "info";

interface ToneClass {
  text: string;
  /** Lighter background (default). */
  bg: string;
  /** Heavier background, used when `solid` is set. */
  bgSolid: string;
}

// Module-private tone palette. The caller maps its own domain enum
// (status / is_active / voucher state) to one of these tones and passes a
// plain label; nothing domain-specific leaks into this atom.
//
// Flat tinted bg + text, no border — a borderless chip reads cleaner at the
// compact sizes tables now use than the previous bordered pill did.
const TONE_CLASS: Record<StatusTone, ToneClass> = {
  success: {
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    bgSolid: "bg-emerald-500/20",
  },
  neutral: {
    text: "text-zinc-400",
    bg: "bg-zinc-800/60",
    bgSolid: "bg-zinc-700/40",
  },
  warning: {
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    bgSolid: "bg-amber-500/20",
  },
  danger: {
    text: "text-red-400",
    bg: "bg-red-500/10",
    bgSolid: "bg-red-500/20",
  },
  info: {
    text: "text-blue-400",
    bg: "bg-blue-500/10",
    bgSolid: "bg-blue-500/20",
  },
};

interface StatusPillProps {
  /** Text shown inside the pill (the caller's own label), rendered as-is —
   *  the caller decides case. */
  label: string;
  /** Domain-free tone selector. The caller maps its enum to one of these. */
  tone: StatusTone;
  /** Heavier /20 background; default is the lighter /10 background. */
  solid?: boolean;
  /** Extra classes on the pill wrapper. */
  class?: string;
  testId?: string;
}

// Single status-pill atom: a flat tinted-bg text chip, no border, no leading
// dot, no forced case — the caller's label renders exactly as given. `solid`
// switches to the heavier background. Domain enum -> tone + label mapping
// stays with the caller.
export default function StatusPill(props: StatusPillProps): JSX.Element {
  const tc = () => TONE_CLASS[props.tone];
  const bg = () => (props.solid ? tc().bgSolid : tc().bg);
  return (
    <span
      data-testid={props.testId}
      class={`inline-flex items-center text-xs px-1.5 py-0.5 rounded ${tc().text} ${bg()} ${props.class ?? ""}`}
    >
      {props.label}
    </span>
  );
}
