import { Show, type JSX } from "solid-js";

export type StatusTone = "success" | "neutral" | "warning" | "danger" | "info";

interface ToneClass {
  text: string;
  /** Lighter background (default, the packages-style /10). */
  bg: string;
  /** Heavier background (the clients/vouchers-style /20, used when solid). */
  bgSolid: string;
  border: string;
  /** Fill color for the optional leading dot. */
  dot: string;
}

// Module-private tone palette. The caller maps its own domain enum
// (status / is_active / voucher state) to one of these tones and passes a
// plain label; nothing domain-specific leaks into this atom.
const TONE_CLASS: Record<StatusTone, ToneClass> = {
  success: {
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    bgSolid: "bg-emerald-500/20",
    border: "border-emerald-400/40",
    dot: "bg-emerald-400",
  },
  neutral: {
    text: "text-zinc-400",
    bg: "bg-zinc-800/60",
    bgSolid: "bg-zinc-700/40",
    border: "border-zinc-600",
    dot: "bg-zinc-400",
  },
  warning: {
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    bgSolid: "bg-amber-500/20",
    border: "border-amber-400/40",
    dot: "bg-amber-400",
  },
  danger: {
    text: "text-red-400",
    bg: "bg-red-500/10",
    bgSolid: "bg-red-500/20",
    border: "border-red-400/40",
    dot: "bg-red-400",
  },
  info: {
    text: "text-blue-400",
    bg: "bg-blue-500/10",
    bgSolid: "bg-blue-500/20",
    border: "border-blue-400/40",
    dot: "bg-blue-400",
  },
};

interface StatusPillProps {
  /** Text shown inside the pill (the caller's own label). */
  label: string;
  /** Domain-free tone selector. The caller maps its enum to one of these. */
  tone: StatusTone;
  /** Render a leading filled dot in the tone's dot color. */
  dot?: boolean;
  /** Heavier /20 background (clients/vouchers style); default is the
   *  lighter /10 background (packages style). */
  solid?: boolean;
  /** Extra classes on the pill wrapper. */
  class?: string;
  testId?: string;
}

// Single status-pill atom. Baseline is the uppercase, wide-tracked,
// text-[10px] chip from the packages StatusPill. The optional dot covers the
// clients is_active pill, and solid covers the heavier clients/vouchers
// backgrounds. Domain enum -> tone + label mapping stays with the caller.
export default function StatusPill(props: StatusPillProps): JSX.Element {
  const tc = () => TONE_CLASS[props.tone];
  const bg = () => (props.solid ? tc().bgSolid : tc().bg);
  return (
    <span
      data-testid={props.testId}
      class={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider ${tc().text} ${tc().border} ${bg()} ${props.class ?? ""}`}
    >
      <Show when={props.dot}>
        <span class={`h-1.5 w-1.5 rounded-full ${tc().dot}`} aria-hidden="true" />
      </Show>
      {props.label}
    </span>
  );
}
