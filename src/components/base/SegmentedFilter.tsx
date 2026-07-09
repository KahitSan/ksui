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
  /** Accessible label for the radiogroup wrapper (WAI-ARIA radiogroup pattern). */
  ariaLabel?: string;
}

// A rounded bordered row of segment buttons with one active at a time.
// Presentational only and domain free: the caller passes the segment values
// and the active value, so there are no status literals baked in here.
// Semantics follow the WAI-ARIA radiogroup pattern (role="radiogroup" +
// role="radio"/aria-checked per segment + roving tabindex + arrow-key nav) so
// this reads as a single control, not a strip of unrelated buttons.
export default function SegmentedFilter(props: SegmentedFilterProps): JSX.Element {
  const buttonRefs: (HTMLButtonElement | undefined)[] = [];
  const optionOf = (o: SegmentedFilterOption) =>
    typeof o === "string" ? { value: o, label: o, capitalize: true } : { ...o, capitalize: false };

  const currentIndex = () => {
    const i = props.options.findIndex((o) => optionOf(o).value === props.value);
    return i >= 0 ? i : 0;
  };

  const selectByIndex = (idx: number) => {
    const list = props.options;
    if (list.length === 0) return;
    const wrapped = ((idx % list.length) + list.length) % list.length;
    props.onChange(optionOf(list[wrapped]).value);
    buttonRefs[wrapped]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        selectByIndex(currentIndex() + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        selectByIndex(currentIndex() - 1);
        break;
      case "Home":
        e.preventDefault();
        selectByIndex(0);
        break;
      case "End":
        e.preventDefault();
        selectByIndex(props.options.length - 1);
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={props.ariaLabel}
      class={`flex rounded-lg border border-[var(--ks-border,rgba(39,39,42,0.5))] overflow-hidden ${props.class ?? ""}`}
      onKeyDown={onKeyDown}
    >
      <For each={props.options}>
        {(o, i) => {
          const opt = optionOf(o);
          const selected = () => props.value === opt.value;
          const isTabStop = () => selected() || (!props.value && i() === 0);
          return (
            <button
              ref={(el) => (buttonRefs[i()] = el)}
              type="button"
              role="radio"
              aria-checked={selected()}
              tabIndex={isTabStop() ? 0 : -1}
              data-testid={props.testIdPrefix ? `${props.testIdPrefix}-${opt.value}` : undefined}
              onClick={() => props.onChange(opt.value)}
              class="px-3 py-1.5 text-xs transition-colors cursor-pointer"
              classList={{
                capitalize: opt.capitalize,
                "bg-[var(--ks-accent,#fbbf24)]/20 text-[var(--ks-accent,#fbbf24)]": selected(),
                "text-[var(--ks-fg-muted,#a1a1aa)] hover:text-[var(--ks-fg,#ffffff)] hover:bg-[var(--ks-surface-raised,#1a1a1a)]":
                  !selected(),
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
