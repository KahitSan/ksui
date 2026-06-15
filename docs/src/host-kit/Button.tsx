// Source: KahitSan/ksc components/Button/Button.tsx
import { splitProps, createSignal, onCleanup, createMemo, mergeProps, Show, For } from "solid-js";
import { Dynamic } from "solid-js/web";

type ButtonIntent = "primary" | "danger" | "secondary";
type ButtonVariant = "clip1" | "clip2" | "ghost" | "link";

export interface ButtonProps {
  as?: any;
  intent?: ButtonIntent;
  variant?: ButtonVariant;
  noRipple?: boolean;
  noScanline?: boolean;
  noGlow?: boolean;
  noPulse?: boolean;
  icon?: (props: { size?: number; class?: string }) => any;
  iconPosition?: "left" | "right";
  class?: string;
  disabled?: boolean;
  children?: any;
  type?: string;
  onClick?: (event: MouseEvent) => void;
  [key: string]: any;
}

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

const buttonIntentConfig = {
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

const buttonVariantConfig = {
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
    baseClasses:
      "px-4 py-2 bg-transparent border-transparent hover:bg-current/10 hover:border-transparent",
    overrideType: true,
  },
  link: {
    effects: [],
    baseClasses:
      "px-0 py-0 bg-transparent border-transparent underline-offset-4 hover:underline hover:bg-transparent hover:border-transparent",
    overrideType: true,
  },
};

const Button = (props: ButtonProps) => {
  const defaultProps = {
    as: "button",
    intent: "primary" as ButtonIntent,
    variant: "clip1" as ButtonVariant,
    noRipple: false,
    noScanline: false,
    noGlow: false,
    noPulse: false,
    iconPosition: "left" as const,
  };

  const merged = mergeProps(defaultProps, props);

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

  const [ripples, setRipples] = createSignal<
    Array<{ id: number; x: number; y: number; size: number; isFading: boolean }>
  >([]);

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
          scanline: "ks-hud-scan-line",
          "clip-top-left-bottom-right": "ks-hud-clip-top-left-bottom-right",
          "clip-top-right-bottom-left": "ks-hud-clip-top-right-bottom-left",
          "clip-minimal-top-left-bottom-right": "ks-hud-clip-minimal-top-left-bottom-right",
          "clip-minimal-top-right-bottom-left": "ks-hud-clip-minimal-top-right-bottom-left",
          glow: "ks-hud-glow",
          pulse: "ks-hud-pulse",
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
    };
  });

  const classes = createMemo(() => {
    const coreClasses =
      "select-none cursor-pointer inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 focus:outline-none text-sm rounded";
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
      hasRipple() && "ks-btn-ripple",
      !hasRipple() && "ks-interactive",
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
      // eslint-disable-next-line sonarjs/pseudo-random (non-crypto, visual/animation only)
      const rippleId = Date.now() + Math.random();
      setRipples((prev) => [...prev, { id: rippleId, x, y, size, isFading: false }]);
    }
  };

  const startFade = () => {
    setRipples((prev) => prev.map((r) => ({ ...r, isFading: true })));
    setTimeout(() => setRipples([]), 400);
  };

  const handleMouseUp = () => {
    if (!hasRipple() || local.disabled) return;
    const timeSinceMouseDown = Date.now() - mouseDownTime;
    const delayBeforeFade = Math.max(0, 400 - timeSinceMouseDown);
    setTimeout(startFade, delayBeforeFade);
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

  const sharedProps = () => ({
    ref: (el: HTMLElement) => {
      elementRef = el;
      if (typeof others.ref === "function") others.ref(el);
    },
    class: classes(),
    style: customProperties(),
    onMouseDown: handleMouseDown,
    onMouseUp: handleMouseUp,
    onMouseLeave: handleMouseLeave,
    onClick: handleClick,
    disabled: local.disabled,
    ...others,
  });

  const rippleElements = () => (
    <Show when={hasRipple()}>
      <For each={ripples()}>
        {(ripple) => (
          <span
            class={cn("ks-btn-ripple-effect", ripple.isFading && "ks-btn-ripple-fade")}
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
  );

  // Use native <button> for default case so solid-devtools can inject data-source-loc.
  // Dynamic is only needed for polymorphic rendering (as={A}, as="a", etc.)
  return (
    <Show
      when={local.as !== "button"}
      fallback={
        <button {...(sharedProps() as any)}>
          {renderContent()}
          {rippleElements()}
        </button>
      }
    >
      <Dynamic component={local.as} {...sharedProps()}>
        {renderContent()}
        {rippleElements()}
      </Dynamic>
    </Show>
  );
};

export default Button;
