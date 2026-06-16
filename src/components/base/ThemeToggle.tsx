// Source: kahitsan-web src/components/Header.tsx (ThemeToggle, lines 30-45)
// + its CSS in src/assets/css/button.css (.ks-theme-toggle*).
// Extracted as a domain-free, controlled primitive: the theme state is lifted
// to props (`value` + `onToggle`) so it carries no dependency on kahitsan's
// ~/lib/theme. Only solid-js + lucide-solid.
//
// ksui ships no sibling .css and no sidecar CSS in the published package, so
// the custom track/thumb/icon styles (transitions, the sliding ::after thumb)
// are injected once at runtime via a <style> tag — the same pattern ProgressBar
// uses — and referenced by plain, unscoped class names.

import type { JSX } from "solid-js";
import { splitProps } from "solid-js";
import Sun from "lucide-solid/icons/sun";
import Moon from "lucide-solid/icons/moon";

const THEME_TOGGLE_STYLE_ID = "ks-theme-toggle-inline-style";
const THEME_TOGGLE_CSS = `
.ks-theme-toggle { background: none; border: none; padding: 2px; cursor: pointer; display: flex; align-items: center; }
.ks-theme-toggle-track { position: relative; display: flex; align-items: center; justify-content: space-between; width: 52px; height: 28px; border-radius: 14px; background-color: #3f3f46; padding: 0 2px; transition: background-color 0.3s ease; }
.ks-theme-toggle-track[data-active] { background-color: #d3c5ac; }
.ks-theme-toggle-icon { position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; pointer-events: none; transition: color 0.3s ease; }
.ks-theme-toggle-track::after { content: ''; position: absolute; left: 2px; top: 2px; width: 24px; height: 24px; border-radius: 50%; background-color: #52525b; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); transition: transform 0.3s ease, background-color 0.3s ease; z-index: 1; }
.ks-theme-toggle-track[data-active]::after { transform: translateX(24px); background-color: #ffffff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15); }
.ks-theme-toggle-icon-moon { color: #fbbf24; }
.ks-theme-toggle-icon-sun { color: rgba(255, 255, 255, 0.3); }
.ks-theme-toggle-track[data-active] .ks-theme-toggle-icon-moon { color: rgba(120, 90, 0, 0.3); }
.ks-theme-toggle-track[data-active] .ks-theme-toggle-icon-sun { color: #785a00; }
.ks-theme-toggle:hover .ks-theme-toggle-track { background-color: #52525b; }
.ks-theme-toggle:hover .ks-theme-toggle-track[data-active] { background-color: #c9b99a; }
@media (prefers-reduced-motion: reduce) { .ks-theme-toggle-track, .ks-theme-toggle-track::after, .ks-theme-toggle-icon { transition: none; } }
`;

function ensureThemeToggleStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(THEME_TOGGLE_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = THEME_TOGGLE_STYLE_ID;
  el.textContent = THEME_TOGGLE_CSS;
  document.head.appendChild(el);
}

export type ThemeToggleValue = "dark" | "light";

export interface ThemeToggleProps
  extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onToggle"> {
  /** Current theme. `"light"` slides the thumb right and activates the sun. */
  value: ThemeToggleValue;
  /** Called with the opposite theme when the toggle is clicked. */
  onToggle: (next: ThemeToggleValue) => void;
  /**
   * Accessible label. Receives the theme the click will switch TO so the
   * default reads e.g. "Switch to light mode". Override for non-English UIs.
   */
  ariaLabel?: (next: ThemeToggleValue) => string;
  /** Optional test hook (data-testid). */
  testId?: string;
}

function cn(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(" ");
}

const defaultAriaLabel = (next: ThemeToggleValue): string => `Switch to ${next} mode`;

/**
 * A controlled sliding sun/moon track toggle. Domain-free: it owns no theme
 * state and applies no theme — it renders `value` and reports the intended
 * next value through `onToggle`. The parent owns the theme source of truth.
 */
export default function ThemeToggle(props: ThemeToggleProps): JSX.Element {
  ensureThemeToggleStyle();

  const [local, rest] = splitProps(props, [
    "value",
    "onToggle",
    "ariaLabel",
    "testId",
    "class",
    "onClick",
  ]);

  const isLight = (): boolean => local.value === "light";
  const next = (): ThemeToggleValue => (isLight() ? "dark" : "light");
  const label = (): string => (local.ariaLabel ?? defaultAriaLabel)(next());

  const handleClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    local.onToggle(next());
    if (typeof local.onClick === "function") local.onClick(event);
  };

  return (
    <button
      type="button"
      class={cn("ks-theme-toggle", local.class)}
      aria-label={label()}
      title={label()}
      data-testid={local.testId}
      onClick={handleClick}
      {...rest}
    >
      <span class="ks-theme-toggle-track" data-active={isLight() ? "" : undefined}>
        <span class="ks-theme-toggle-icon ks-theme-toggle-icon-moon">
          <Moon size={12} />
        </span>
        <span class="ks-theme-toggle-icon ks-theme-toggle-icon-sun">
          <Sun size={12} />
        </span>
      </span>
    </button>
  );
}
