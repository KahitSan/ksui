import { Show, type JSX } from "solid-js";

export type StatusIndicatorTone = "success" | "neutral" | "warning" | "danger" | "info";

interface ToneClass {
  /** Filled dot color. */
  dot: string;
  /** Label text color. */
  text: string;
  /** Box-shadow glow used when the dot pulses (an arbitrary Tailwind value). */
  glow: string;
}

// Module-private tone palette. The caller maps its own availability/state
// (online/offline, open/closed, healthy/degraded) to one of these tones and
// passes a plain label; nothing domain-specific leaks into this atom.
const TONE_CLASS: Record<StatusIndicatorTone, ToneClass> = {
  success: {
    dot: "bg-emerald-400",
    text: "text-white",
    glow: "shadow-[0_0_10px_rgba(52,211,153,0.6)]",
  },
  neutral: {
    dot: "bg-zinc-400",
    text: "text-zinc-400",
    glow: "shadow-[0_0_10px_rgba(161,161,170,0.5)]",
  },
  warning: {
    dot: "bg-amber-400",
    text: "text-amber-300",
    glow: "shadow-[0_0_10px_rgba(251,191,36,0.6)]",
  },
  danger: {
    dot: "bg-red-400",
    text: "text-zinc-500",
    glow: "shadow-[0_0_10px_rgba(248,113,113,0.6)]",
  },
  info: {
    dot: "bg-blue-400",
    text: "text-blue-300",
    glow: "shadow-[0_0_10px_rgba(96,165,250,0.6)]",
  },
};

export interface StatusIndicatorProps {
  /** Text shown beside the dot (the caller's own label). */
  label: string;
  /** Domain-free tone selector. The caller maps its enum to one of these. */
  tone?: StatusIndicatorTone;
  /**
   * Convenience boolean: when provided, overrides `tone` with `success` (true)
   * or `danger` (false). Lets a caller bind a plain availability flag.
   */
  online?: boolean;
  /** Animate the dot with a pulse + glow (good for a "live" indicator). */
  pulse?: boolean;
  /** Render the label uppercase with wide tracking (the marquee/chip style). */
  uppercase?: boolean;
  /** Optional small caption above the label (e.g. a category line). */
  caption?: string;
  /** Caption text color class; defaults to an amber accent. */
  captionClass?: string;
  /** Extra classes on the wrapper. */
  class?: string;
  testId?: string;
}

// Single availability-indicator atom. A filled, optionally pulsing colored dot
// next to a label. Distinct from StatusPill (a bordered tinted text chip) — this
// is the animated "live status" dot. The caller owns the domain → tone mapping
// and the label text.
export default function StatusIndicator(props: StatusIndicatorProps): JSX.Element {
  const tone = (): StatusIndicatorTone =>
    props.online === undefined ? (props.tone ?? "neutral") : props.online ? "success" : "danger";
  const tc = () => TONE_CLASS[tone()];

  return (
    <div
      data-testid={props.testId}
      class={`flex items-center gap-3 ${props.class ?? ""}`}
    >
      <span
        aria-hidden="true"
        class={`h-3 w-3 shrink-0 rounded-full ${tc().dot} ${
          props.pulse ? `animate-pulse ${tc().glow}` : ""
        }`}
      />
      <div>
        <Show when={props.caption}>
          <div
            class={`text-xs font-bold uppercase tracking-widest ${
              props.captionClass ?? "text-amber-400"
            }`}
          >
            {props.caption}
          </div>
        </Show>
        <div
          class={`${tc().text} ${
            props.uppercase
              ? "text-xs font-bold uppercase tracking-widest"
              : "text-sm font-bold"
          }`}
        >
          {props.label}
        </div>
      </div>
    </div>
  );
}
