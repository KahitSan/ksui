import { createEffect, Show, For } from "solid-js";
import AccountAvatar from "../base/AccountAvatar";
import type { PaymentAccountOption } from "./PaymentAccountPicker";

export interface AccountRadioPickerProps {
  accounts: PaymentAccountOption[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  excludeId?: string;
  autoDefault?: boolean;
}

export default function AccountRadioPicker(props: AccountRadioPickerProps) {
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
          class="w-full bg-[color-mix(in_srgb,var(--ks-surface,#0f0f0f)_60%,transparent)] border border-[color-mix(in_srgb,var(--ks-border,rgba(39,39,42,0.5))_60%,transparent)] px-3 py-3 text-sm text-[var(--ks-fg,#ffffff)] ks-hud-clip-button focus:outline-none focus:border-[color-mix(in_srgb,var(--ks-accent,#fbbf24)_50%,transparent)]"
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
                  "border-[color-mix(in_srgb,var(--ks-accent,#fbbf24)_50%,transparent)] bg-[color-mix(in_srgb,var(--ks-accent,#fbbf24)_10%,transparent)] text-[var(--ks-accent-hover,#fcd34d)]":
                    selected(),
                  "border-[var(--ks-border-strong,#3f3f46)] bg-[color-mix(in_srgb,var(--ks-surface-raised,#1a1a1a)_50%,transparent)] text-[var(--ks-fg-muted,#a1a1aa)] hover:border-[var(--ks-border-strong,#3f3f46)] hover:bg-[var(--ks-surface-raised,#1a1a1a)]":
                    !selected(),
                }}
              >
                <AccountAvatar
                  account={a}
                  size={24}
                  iconClass={
                    selected()
                      ? "text-[var(--ks-accent-hover,#fcd34d)]"
                      : "text-[var(--ks-fg-muted,#a1a1aa)]"
                  }
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
