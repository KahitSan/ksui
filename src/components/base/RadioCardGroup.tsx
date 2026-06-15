import { For, type JSX } from "solid-js";

interface RadioCardGroupProps<T> {
  /** The selectable options. */
  options: T[];
  /** The currently selected key, or null when nothing is selected. */
  value: string | null;
  /** Fired with the chosen option's key when selection changes. */
  onChange: (value: string) => void;
  /** Derives the stable string key for an option (used for value matching). */
  keyOf: (option: T) => string;
  /**
   * Renders the inner content of one card. Receives the option and whether it
   * is selected. Defaults to a dot + label layout (see `labelOf`). Callers that
   * need a richer layout (price, avatar, secondary line) pass their own.
   */
  renderOption?: (option: T, selected: boolean) => JSX.Element;
  /**
   * Derives the text label for the default `renderOption`. Falls back to
   * String(keyOf(option)) when omitted. Ignored when `renderOption` is supplied.
   */
  labelOf?: (option: T) => string;
  /** Accessible label for the radiogroup wrapper. */
  ariaLabel: string;
  /**
   * Grid column behavior. A number sets a fixed column count; "auto" (default)
   * uses the responsive 2-up / 3-up grid that the source pickers used.
   */
  columns?: number | "auto";
  /** Extra classes on the wrapper grid. */
  class?: string;
  /**
   * Extra classes applied to every item button. Use this to override the
   * default amber-active styling per call site.
   */
  itemClass?: string;
}

// A controlled, keyboard-navigable group of radio cards. The reusable part is
// the roving-tabindex keyboard model that the transactions account picker and
// the subscriptions variant picker carried verbatim: arrow keys move and select
// with modulo wrap, Home/End jump to the ends, and exactly one item is a tab
// stop (the selected one, or the first item when nothing is selected).
//
// Domain content stays out of this component: the caller supplies `keyOf` to
// match the controlled `value` and an optional `renderOption` for the card body.
// The default body is a dot + label, which covers the simplest case; richer
// layouts (price lines, avatars) come in through `renderOption`.
export default function RadioCardGroup<T>(props: RadioCardGroupProps<T>): JSX.Element {
  const buttonRefs: (HTMLButtonElement | undefined)[] = [];

  const keyAt = (option: T) => props.keyOf(option);

  const currentIndex = () => {
    const i = props.options.findIndex((o) => keyAt(o) === props.value);
    return i >= 0 ? i : 0;
  };

  const selectByIndex = (idx: number) => {
    const list = props.options;
    if (list.length === 0) return;
    const wrapped = ((idx % list.length) + list.length) % list.length;
    props.onChange(keyAt(list[wrapped]));
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

  const gridClass = () => {
    const cols = props.columns ?? "auto";
    if (cols === "auto") return "grid max-sm:grid-cols-2 sm:grid-cols-3 gap-2";
    return `grid gap-2 grid-cols-${cols}`;
  };

  const label = (option: T) => props.labelOf?.(option) ?? String(props.keyOf(option));

  const defaultRender = (option: T, selected: boolean) => (
    <>
      <span
        class="h-2 w-2 rounded-full shrink-0"
        classList={{
          "bg-amber-400": selected,
          "bg-zinc-600 group-hover:bg-zinc-500": !selected,
        }}
      />
      <span class="truncate">{label(option)}</span>
    </>
  );

  return (
    <div
      role="radiogroup"
      aria-label={props.ariaLabel}
      tabIndex={-1}
      class={`${gridClass()} ${props.class ?? ""}`}
      onKeyDown={onKeyDown}
    >
      <For each={props.options}>
        {(option, i) => {
          const k = keyAt(option);
          const selected = () => props.value === k;
          const isTabStop = () => selected() || (!props.value && i() === 0);
          return (
            <button
              ref={(el) => (buttonRefs[i()] = el)}
              type="button"
              role="radio"
              aria-checked={selected()}
              tabIndex={isTabStop() ? 0 : -1}
              onClick={() => props.onChange(k)}
              class={`group flex items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm transition-colors cursor-pointer ${props.itemClass ?? ""}`}
              classList={{
                "border-amber-500/50 bg-amber-600/10 text-amber-300": selected(),
                "border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800":
                  !selected(),
              }}
            >
              {(props.renderOption ?? defaultRender)(option, selected())}
            </button>
          );
        }}
      </For>
    </div>
  );
}
