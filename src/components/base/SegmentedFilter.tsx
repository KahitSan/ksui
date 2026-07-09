import { For, type JSX } from "solid-js";

/** One choice in the segmented row. A bare string uses the value as the label
 *  and is rendered capitalized; an object lets the caller supply an explicit
 *  label that is NOT capitalized (for buckets or other non-status toggles). */
export type SegmentedFilterOption = string | { value: string; label: string };

interface SegmentedFilterProps {
  /** The available segments, left to right. */
  options: SegmentedFilterOption[];
  /** The currently active value. Matched against each option's value. */
  value: string;
  /** Called with the chosen value when a segment is clicked. */
  onChange: (value: string) => void;
  /** Prefix for each segment's data-testid (`${prefix}-${value}`). */
  testIdPrefix?: string;
  /** Extra classes on the outer bordered row. */
  class?: string;
}

// A rounded bordered row of segment buttons with one active at a time.
// Presentational only and domain free: the caller passes the segment values
// and the active value, so there are no status literals baked in here.
export default function SegmentedFilter(props: SegmentedFilterProps): JSX.Element {
  const optionOf = (o: SegmentedFilterOption) =>
    typeof o === "string" ? { value: o, label: o, capitalize: true } : { ...o, capitalize: false };
  return (
    <div class={`flex rounded-lg border border-[var(--ks-border,rgba(39,39,42,0.5))] overflow-hidden ${props.class ?? ""}`}>
      <For each={props.options}>
        {(o) => {
          const opt = optionOf(o);
          return (
            <button
              data-testid={props.testIdPrefix ? `${props.testIdPrefix}-${opt.value}` : undefined}
              onClick={() => props.onChange(opt.value)}
              class="px-3 py-1.5 text-xs transition-colors cursor-pointer"
              classList={{
                capitalize: opt.capitalize,
                "bg-[var(--ks-accent,#fbbf24)]/20 text-[var(--ks-accent,#fbbf24)]": props.value === opt.value,
                "text-[var(--ks-fg-muted,#a1a1aa)] hover:text-[var(--ks-fg,#ffffff)] hover:bg-[var(--ks-surface-raised,#1a1a1a)]":
                  props.value !== opt.value,
              }}
            >
              {opt.label}
            </button>
          );
        }}
      </For>
    </div>
  );
}
