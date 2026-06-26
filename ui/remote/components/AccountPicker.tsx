import { createEffect, Show, For } from "solid-js";
import { type FinancialAccount } from "../lib/types";

export default function AccountPicker(props: {
  accounts: FinancialAccount[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  excludeId?: string;
  autoDefault?: boolean;
}) {
  const visible = () =>
    props.accounts.filter(
      (a) => !props.excludeId || a.id.toString() !== props.excludeId
    );

  createEffect(() => {
    if (props.autoDefault === false) return;
    if (props.value) return;
    const first = visible()[0];
    if (first) props.onChange(first.id.toString());
  });

  const buttonRefs: (HTMLButtonElement | undefined)[] = [];

  const currentIndex = () => {
    const list = visible();
    const i = list.findIndex((a) => a.id.toString() === props.value);
    return i >= 0 ? i : 0;
  };

  const selectByIndex = (idx: number) => {
    const list = visible();
    if (list.length === 0) return;
    const wrapped = ((idx % list.length) + list.length) % list.length;
    props.onChange(list[wrapped].id.toString());
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
        selectByIndex(visible().length - 1);
        break;
    }
  };

  return (
    <Show
      when={props.accounts.length > 0}
      fallback={
        <input
          type="number"
          value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          aria-label={props.ariaLabel}
          placeholder="Account ID (financial-accounts module unavailable)"
          class="w-full bg-zinc-900/60 border border-zinc-800/60 px-3 py-3 text-sm text-zinc-200 ks-hud-clip-button focus:outline-none focus:border-amber-500/50"
        />
      }
    >
      <div
        role="radiogroup"
        aria-label={props.ariaLabel}
        tabIndex={-1}
        class="grid max-sm:grid-cols-2 sm:grid-cols-3 gap-2"
        onKeyDown={onKeyDown}
      >
        <For each={visible()}>
          {(a, i) => {
            const selected = () => props.value === a.id.toString();
            const isTabStop = () => selected() || (!props.value && i() === 0);
            return (
              <button
                ref={(el) => (buttonRefs[i()] = el)}
                type="button"
                role="radio"
                aria-checked={selected()}
                tabIndex={isTabStop() ? 0 : -1}
                onClick={() => props.onChange(a.id.toString())}
                class="group flex items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm transition-colors cursor-pointer ks-hud-clip-top-left-bottom-right"
                classList={{
                  "border-amber-500/50 bg-amber-600/10 text-amber-300":
                    selected(),
                  "border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800":
                    !selected(),
                }}
              >
                <span
                  class="h-2 w-2 rounded-full shrink-0"
                  classList={{
                    "bg-amber-400": selected(),
                    "bg-zinc-600 group-hover:bg-zinc-500": !selected(),
                  }}
                />
                <span class="truncate">{a.name}</span>
              </button>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
