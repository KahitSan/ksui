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
    text: "text-[var(--ks-success-fg,#34d399)]",
    bg: "bg-[var(--ks-success-bg,rgba(16,185,129,0.12))]",
    bgSolid: "bg-[var(--ks-success,#10b981)]/20",
  },
  neutral: {
    text: "text-[var(--ks-fg-muted,#a1a1aa)]",
    bg: "bg-[var(--ks-surface-raised,#1a1a1a)]",
    bgSolid: "bg-[var(--ks-surface-sunken,#141414)]",
  },
  warning: {
    text: "text-[var(--ks-warning-fg,#fbbf24)]",
    bg: "bg-[var(--ks-warning-bg,rgba(245,158,11,0.12))]",
    bgSolid: "bg-[var(--ks-warning,#f59e0b)]/20",
  },
  danger: {
    text: "text-[var(--ks-danger-fg,#f87171)]",
    bg: "bg-[var(--ks-danger-bg,rgba(239,68,68,0.12))]",
    bgSolid: "bg-[var(--ks-danger,#ef4444)]/20",
  },
  info: {
    text: "text-[var(--ks-info-fg,#7dd3fc)]",
    bg: "bg-[var(--ks-info-bg,rgba(56,189,248,0.12))]",
    bgSolid: "bg-[var(--ks-info,#38bdf8)]/20",
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
