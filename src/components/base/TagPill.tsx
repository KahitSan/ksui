import { type JSX } from "solid-js";

interface TagPillProps {
  /** The text to render inside the pill. */
  label: string;
  /** Extra classes on the pill span. */
  class?: string;
}

// A tiny, intentionally neutral rounded-full chip for category/tag lists.
// It is strictly zinc with no tone, no dot, and no uppercase, which keeps it
// visually distinct from StatusPill. When a caller needs a colored chip they
// should reach for StatusPill instead. Domain-free and presentational only.
export default function TagPill(props: TagPillProps): JSX.Element {
  return (
    <span
      class={`inline-block rounded-full border border-zinc-700 bg-zinc-800/50 px-2 py-0.5 text-[10px] text-zinc-400 ${
        props.class ?? ""
      }`}
    >
      {props.label}
    </span>
  );
}
