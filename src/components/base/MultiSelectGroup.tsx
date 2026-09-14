import { For, type JSX } from "solid-js";

export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  disabledNote?: string;
}

export type MultiSelectGroupVariant = "info" | "accent";
export interface MultiSelectGroupProps {
  options: MultiSelectOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  ariaLabel: string;
  class?: string;
  itemClass?: string;
  disabled?: boolean;
  /** Selected-state palette. Defaults to the existing info treatment. */
  variant?: MultiSelectGroupVariant;
}

export default function MultiSelectGroup(props: MultiSelectGroupProps): JSX.Element {
  const selected = (value: string) => props.value.includes(value);
  const toggle = (option: MultiSelectOption) => {
    if (props.disabled || option.disabled) return;
    const next = selected(option.value)
      ? props.value.filter((value) => value !== option.value)
      : props.options.filter((candidate) => candidate.value === option.value || props.value.includes(candidate.value)).map((candidate) => candidate.value);
    props.onChange(next);
  };

  return (
    <div role="group" aria-label={props.ariaLabel} class={`flex flex-wrap gap-1 ${props.class ?? ""}`}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            aria-pressed={selected(option.value)}
            disabled={props.disabled || option.disabled}
            title={option.disabledNote}
            onClick={() => toggle(option)}
            class={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${props.itemClass ?? ""}`}
            classList={{
              "border-[var(--ks-info,#38bdf8)] bg-[var(--ks-info,#38bdf8)] text-[var(--ks-info-fg,#7dd3fc)]": selected(option.value) && (props.variant ?? "info") === "info",
              "border-[var(--ks-accent,#fbbf24)] bg-[color-mix(in_srgb,var(--ks-accent,#fbbf24)_20%,transparent)] font-semibold text-[var(--ks-accent,#fbbf24)]": selected(option.value) && props.variant === "accent",
              "border-[var(--ks-border,rgba(39,39,42,0.5))] bg-[var(--ks-surface,#0f0f0f)] text-[var(--ks-fg-muted,#a1a1aa)] hover:border-[var(--ks-border-strong,#3f3f46)] hover:text-[var(--ks-fg,#ffffff)]": !selected(option.value),
              "cursor-not-allowed opacity-50": !!props.disabled || !!option.disabled,
            }}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}
