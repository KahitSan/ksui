// Source: kahitsan-web src/components/ui/Button/Button.tsx (+ assets/css/button.css).
// Extracted into ksui as a DOMAIN-FREE base primitive: an intent/variant button
// with HUD scanline, clip-corner, ripple, glow, and pulse effects. It depends
// only on solid-js (Dynamic) — no host kit, no kahitsan imports, no marketing
// copy. The intent palette (amber/red/slate rgba maps) ships as the generic
// default tone set; callers pass intent + variant and their own children.
//
// The monolith shipped these effects as global CSS (button.css). ksui publishes
// no sidecar .css (the package exports only ./src under the `solid` condition),
// so — like ProgressBar / LiveTimer — the keyframes + helper classes are
// injected once per page via a runtime <style> tag and referenced with plain,
// unscoped class names so the bundle stays self-contained.

import {
  splitProps,
  createSignal,
  onCleanup,
  createMemo,
  mergeProps,
  Show,
  For,
  type JSX,
  type Component,
} from "solid-js";
import { Dynamic } from "solid-js/web";

const BUTTON_STYLE_ID = "ks-button-inline-style";
const BUTTON_CSS = `
.ks-hud-scan-line { position: relative; overflow: hidden; }
.ks-hud-scan-line::before { content: ''; position: absolute; top: 0; left: -100%; width: 100%; height: 100%; opacity: 0; pointer-events: none; z-index: 1; transition: opacity 0.2s ease; background: linear-gradient(90deg, transparent, var(--ks-effect-color, rgba(201, 169, 97, 0.4)), transparent); }
.ks-hud-scan-line:hover::before { left: 100%; opacity: 1; transition: all 0.8s ease; }
.ks-hud-clip-top-left-bottom-right { clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px); border: none !important; border-radius: 0 !important; }
.ks-hud-clip-top-right-bottom-left { clip-path: polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px)); border: none !important; border-radius: 0 !important; }
.ks-hud-clip-minimal-top-left-bottom-right { clip-path: polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px); border: none !important; border-radius: 0 !important; }
.ks-hud-clip-minimal-top-right-bottom-left { clip-path: polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px)); border: none !important; border-radius: 0 !important; }
.ks-hud-glow { transition: box-shadow 0.2s ease; box-shadow: 0 0 8px var(--ks-effect-glow, rgba(201, 169, 97, 0.3)); }
.ks-hud-glow:hover:not(:disabled) { box-shadow: 0 0 15px var(--ks-effect-glow-hover, rgba(201, 169, 97, 0.5)); }
.ks-hud-pulse { animation: ksHudPulse 2s infinite ease-in-out; }
@keyframes ksHudPulse { 0%, 100% { background-color: var(--ks-effect-pulse-bg, rgba(201, 169, 97, 0.1)); box-shadow: 0 0 5px var(--ks-effect-pulse-glow, rgba(201, 169, 97, 0.2)); } 50% { background-color: var(--ks-effect-pulse-bg-mid, rgba(201, 169, 97, 0.2)); box-shadow: 0 0 10px var(--ks-effect-pulse-glow-mid, rgba(201, 169, 97, 0.4)); } }
.ks-btn-ripple { position: relative; overflow: hidden; }
.ks-btn-ripple-effect { position: absolute; border-radius: 50%; transform: scale(0.1); opacity: 0.8; animation: ksButtonRippleExpand 0.4s ease-out forwards; pointer-events: none; z-index: 0; background-color: var(--ks-ripple-color, rgba(255, 255, 255, 0.3)); }
.ks-btn-ripple-fade { animation: ksButtonRippleFadeOnly 0.3s ease-out forwards; }
@keyframes ksButtonRippleExpand { 0% { transform: scale(0.1); opacity: 0.5; } 100% { transform: scale(1); opacity: 0.25; } }
@keyframes ksButtonRippleFadeOnly { 0% { opacity: 0.3; transform: scale(1); } 100% { opacity: 0; transform: scale(1.1); } }
.ks-btn-ripple > *:not(.ks-btn-ripple-effect) { position: relative; z-index: 2; }
.ks-interactive { transition: all 0.15s ease; }
.ks-interactive:active:not(:disabled) { transform: scale(0.97); opacity: 0.8; }
.ks-interactive:hover:not(:disabled) { transform: scale(1.02); }
`;

function ensureButtonStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(BUTTON_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = BUTTON_STYLE_ID;
  el.textContent = BUTTON_CSS;
  document.head.appendChild(el);
}

const styles: Record<string, string> = {
  "ks-hud-scan-line": "ks-hud-scan-line",
  "ks-hud-clip-top-left-bottom-right": "ks-hud-clip-top-left-bottom-right",
  "ks-hud-clip-top-right-bottom-left": "ks-hud-clip-top-right-bottom-left",
  "ks-hud-clip-minimal-top-left-bottom-right": "ks-hud-clip-minimal-top-left-bottom-right",
  "ks-hud-clip-minimal-top-right-bottom-left": "ks-hud-clip-minimal-top-right-bottom-left",
  "ks-hud-glow": "ks-hud-glow",
  "ks-hud-pulse": "ks-hud-pulse",
  "ks-btn-ripple": "ks-btn-ripple",
  "ks-btn-ripple-effect": "ks-btn-ripple-effect",
  "ks-btn-ripple-fade": "ks-btn-ripple-fade",
  "ks-interactive": "ks-interactive",
};

export type ButtonIntent = "primary" | "danger" | "secondary";
export type ButtonVariant = "clip1" | "clip2" | "ghost" | "link";

export interface ButtonProps {
  /** Element / component to render as (defaults to "button"). */
  as?: string | Component<Record<string, unknown>>;
  intent?: ButtonIntent;
  variant?: ButtonVariant;
  noRipple?: boolean;
  noScanline?: boolean;
  noGlow?: boolean;
  noPulse?: boolean;
  icon?: (props: { size?: number; class?: string }) => JSX.Element;
  iconPosition?: "left" | "right";
  class?: string;
  disabled?: boolean;
  children?: JSX.Element;
  type?: string;
  onClick?: (event: MouseEvent) => void;
  [key: string]: unknown;
}

function cn(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(" ");
}

interface IntentColors {
  ripple: string;
  effect: string;
  effectBg: string;
  effectBorder: string;
  effectGlow: string;
}

interface IntentConfig {
  textColor: string;
  background: string;
  hover: string;
  colors: IntentColors;
}

const buttonIntentConfig: Record<ButtonIntent, IntentConfig> = {
  primary: {
    textColor: "text-amber-400",
    background: "bg-amber-600/20 border-amber-600/60",
    hover: "hover:bg-amber-600/30 hover:border-amber-500",
    colors: {
      ripple: "rgba(255, 255, 255, 0.3)",
      effect: "rgba(201, 169, 97, 0.4)",
      effectBg: "rgba(201, 169, 97, 0.1)",
      effectBorder: "rgba(201, 169, 97, 0.4)",
      effectGlow: "rgba(201, 169, 97, 0.3)",
    },
  },
  danger: {
    textColor: "text-red-400",
    background: "bg-red-600/20 border-red-600/60",
    hover: "hover:bg-red-600/30 hover:border-red-500",
    colors: {
      ripple: "rgba(255, 255, 255, 0.3)",
      effect: "rgba(255, 68, 68, 0.4)",
      effectBg: "rgba(255, 68, 68, 0.1)",
      effectBorder: "rgba(255, 68, 68, 0.4)",
      effectGlow: "rgba(255, 68, 68, 0.3)",
    },
  },
  secondary: {
    textColor: "text-slate-400",
    background: "bg-slate-600/20 border-slate-600/60",
    hover: "hover:bg-slate-600/30 hover:border-slate-500",
    colors: {
      ripple: "rgba(255, 255, 255, 0.3)",
      effect: "rgba(148, 163, 184, 0.4)",
      effectBg: "rgba(148, 163, 184, 0.1)",
      effectBorder: "rgba(148, 163, 184, 0.4)",
      effectGlow: "rgba(148, 163, 184, 0.3)",
    },
  },
};

interface VariantConfig {
  effects: string[];
  baseClasses: string;
  overrideType: boolean;
}

const buttonVariantConfig: Record<ButtonVariant, VariantConfig> = {
  clip1: {
    effects: ["clip-top-left-bottom-right"],
    baseClasses: "px-4 py-2 border",
    overrideType: false,
  },
  clip2: {
    effects: ["clip-top-right-bottom-left"],
    baseClasses: "px-4 py-2 border",
    overrideType: false,
  },
  ghost: {
    effects: [],
    baseClasses: "px-4 py-2 bg-transparent border-transparent hover:bg-current/10 hover:border-transparent",
    overrideType: true,
  },
  link: {
    effects: [],
    baseClasses:
      "px-0 py-0 bg-transparent border-transparent underline-offset-4 hover:underline hover:bg-transparent hover:border-transparent",
    overrideType: true,
  },
};

interface Ripple {
  id: number;
  x: number;
  y: number;
  size: number;
  isFading: boolean;
}

const Button = (props: ButtonProps): JSX.Element => {
  ensureButtonStyle();

  const merged = mergeProps(
    {
      as: "button" as ButtonProps["as"],
      intent: "primary" as ButtonIntent,
      variant: "clip1" as ButtonVariant,
      noRipple: false,
      noScanline: false,
      noGlow: false,
      noPulse: false,
      iconPosition: "left" as const,
    },
    props,
  );

  const [local, others] = splitProps(merged, [
    "as",
    "intent",
    "variant",
    "noRipple",
    "noScanline",
    "noGlow",
    "noPulse",
    "icon",
    "iconPosition",
    "class",
    "children",
    "onClick",
    "disabled",
  ]);

  const [ripples, setRipples] = createSignal<Ripple[]>([]);

  let elementRef: HTMLElement | undefined;
  let mouseDownTime = 0;

  const isIconOnly = createMemo(() => !local.children && local.icon);
  const intentConfig = createMemo(
    () => buttonIntentConfig[local.intent as ButtonIntent] || buttonIntentConfig.primary,
  );
  const variantConfig = createMemo(
    () => buttonVariantConfig[local.variant as ButtonVariant] || buttonVariantConfig.clip1,
  );

  const hasRipple = createMemo(() => {
    if (local.noRipple) return false;
    if (local.variant === "link") return false;
    return true;
  });

  const activeEffects = createMemo(() => {
    const effects: string[] = [...variantConfig().effects];
    if (!local.noScanline) effects.push("scanline");
    return effects;
  });

  const effectClasses = createMemo(() =>
    activeEffects()
      .map((effect) => {
        const effectMap: Record<string, string> = {
          scanline: styles["ks-hud-scan-line"],
          "clip-top-left-bottom-right": styles["ks-hud-clip-top-left-bottom-right"],
          "clip-top-right-bottom-left": styles["ks-hud-clip-top-right-bottom-left"],
          "clip-minimal-top-left-bottom-right": styles["ks-hud-clip-minimal-top-left-bottom-right"],
          "clip-minimal-top-right-bottom-left": styles["ks-hud-clip-minimal-top-right-bottom-left"],
          glow: styles["ks-hud-glow"],
          pulse: styles["ks-hud-pulse"],
        };
        return effectMap[effect];
      })
      .filter(Boolean),
  );

  const customProperties = createMemo(() => {
    const colors = intentConfig().colors;
    return {
      "--ks-effect-color": colors.effect,
      "--ks-effect-bg": colors.effectBg,
      "--ks-effect-border": colors.effectBorder,
      "--ks-effect-bg-hover": colors.effect.replace("0.1", "0.2"),
      "--ks-effect-border-hover": colors.effect.replace("0.4", "0.6"),
      "--ks-effect-glow": colors.effectGlow,
      "--ks-effect-glow-hover": colors.effectGlow.replace("0.3", "0.5"),
      "--ks-effect-pulse-bg": colors.effectBg,
      "--ks-effect-pulse-bg-mid": colors.effect.replace("0.4", "0.2"),
      "--ks-effect-pulse-glow": colors.effectGlow.replace("0.3", "0.2"),
      "--ks-effect-pulse-glow-mid": colors.effectGlow,
      "--ks-ripple-color": colors.ripple,
    } as JSX.CSSProperties;
  });

  const classes = createMemo(() => {
    const coreClasses =
      "select-none inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 focus:outline-none text-sm rounded";
    const textColor = intentConfig().textColor;
    const backgroundClasses = variantConfig().overrideType
      ? ""
      : `${intentConfig().background} ${intentConfig().hover}`;
    const variantClasses = variantConfig().baseClasses;

    return cn(
      coreClasses,
      textColor,
      backgroundClasses,
      variantClasses,
      local.class,
      hasRipple() && styles["ks-btn-ripple"],
      !hasRipple() && styles["ks-interactive"],
      isIconOnly() && "aspect-square !p-2",
      ...effectClasses(),
      local.disabled && "opacity-50 cursor-not-allowed",
    );
  });

  const handleMouseDown = (event: MouseEvent) => {
    if (local.disabled) return;
    if (hasRipple() && elementRef) {
      mouseDownTime = Date.now();
      const rect = elementRef.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const size = Math.max(rect.width, rect.height) * 2;
      const rippleId = Date.now() + Math.random();
      setRipples((prev) => [...prev, { id: rippleId, x, y, size, isFading: false }]);
    }
  };

  const handleMouseUp = () => {
    if (!hasRipple() || local.disabled) return;
    const timeSinceMouseDown = Date.now() - mouseDownTime;
    const delayBeforeFade = Math.max(0, 400 - timeSinceMouseDown);
    setTimeout(() => {
      setRipples((prev) => prev.map((r) => ({ ...r, isFading: true })));
      setTimeout(() => setRipples([]), 400);
    }, delayBeforeFade);
  };

  const handleMouseLeave = () => {
    if (!local.disabled) handleMouseUp();
  };

  const handleClick = (event: MouseEvent) => {
    if (local.onClick && !local.disabled) local.onClick(event);
  };

  const renderContent = createMemo(() => {
    const IconComponent = local.icon;
    if (isIconOnly() && IconComponent) return <IconComponent />;
    if (IconComponent && local.children) {
      const icon = <IconComponent />;
      return local.iconPosition === "left" ? (
        <>
          {icon}
          {local.children}
        </>
      ) : (
        <>
          {local.children}
          {icon}
        </>
      );
    }
    if (IconComponent) return <IconComponent />;
    return local.children;
  });

  onCleanup(() => setRipples([]));

  return (
    <Dynamic
      component={local.as}
      ref={(el: HTMLElement) => {
        elementRef = el;
        const maybeRef = (others as { ref?: unknown }).ref;
        if (typeof maybeRef === "function") (maybeRef as (e: HTMLElement) => void)(el);
      }}
      class={classes()}
      style={customProperties()}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      disabled={local.disabled}
      {...others}
    >
      {renderContent()}
      <Show when={hasRipple()}>
        <For each={ripples()}>
          {(ripple) => (
            <span
              class={cn(styles["ks-btn-ripple-effect"], ripple.isFading && styles["ks-btn-ripple-fade"])}
              style={{
                left: `${ripple.x - ripple.size / 2}px`,
                top: `${ripple.y - ripple.size / 2}px`,
                width: `${ripple.size}px`,
                height: `${ripple.size}px`,
                "background-color": "var(--ks-ripple-color, rgba(255, 255, 255, 0.3))",
              }}
            />
          )}
        </For>
      </Show>
    </Dynamic>
  );
};

export default Button;
