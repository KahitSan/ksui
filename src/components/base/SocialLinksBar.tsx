import { For, type Component, type JSX } from "solid-js";
import { injectCSS } from "../../utils/inject-css";

/** Icon component shape: any component that accepts a numeric `size`
 *  (lucide-solid icons satisfy this, as does any custom SVG component). */
export type SocialIcon = Component<{ size?: number }>;

export interface SocialLink {
  /** Destination URL. Opened in a new tab with rel="noopener noreferrer". */
  href: string;
  /** Icon component rendered inside the button (e.g. a lucide-solid icon). */
  icon: SocialIcon;
  /** Accessible label, used for `aria-label` and `title`. */
  label: string;
}

/** Button outline shape. `round` is a full circle; `clip` cuts the
 *  top-right corner with a clip-path (the angular brand variant). */
export type SocialLinksShape = "round" | "clip";

export interface SocialLinksBarProps {
  /** The links to render. The caller owns the URLs and icons; nothing
   *  domain-specific lives in the component. */
  links: SocialLink[];
  /** Button outline shape. Defaults to `round`. */
  shape?: SocialLinksShape;
  /** Pixel size of each square button. Defaults to 40 (`clip` defaults to 48). */
  buttonSize?: number;
  /** Pixel size of the icon. Defaults to ~45% of the button size. */
  iconSize?: number;
  /** Extra classes on the wrapping `<nav>`. */
  class?: string;
  testId?: string;
}

// Runtime-injected clip-path utility. ksui ships no sidecar CSS (the package
// exports only ./src), so the one rule the `clip` shape needs is emitted once
// as a <style> tag rather than imported from a sibling .css file.
const CLIP_STYLE_ID = "ksui-social-clip-style";
const CLIP_STYLE = `.ksui-social-clip{clip-path:polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,0 100%);}`;

/**
 * A horizontal row of accessible, round (or clip-cornered) icon buttons that
 * link out to external profiles. Each button opens its href in a new tab with
 * a safe `rel`, carries an `aria-label`, and renders the caller-supplied icon.
 *
 * Domain-free: the specific URLs, icons, and labels all come from `links`.
 */
export default function SocialLinksBar(props: SocialLinksBarProps): JSX.Element {
  injectCSS(CLIP_STYLE_ID, CLIP_STYLE);
  const shape = () => props.shape ?? "round";
  const btn = () => props.buttonSize ?? (shape() === "clip" ? 48 : 40);
  const icon = () => props.iconSize ?? Math.round(btn() * 0.45);
  const shapeClass = () =>
    shape() === "clip" ? "ksui-social-clip" : "rounded-full";

  return (
    <nav
      data-testid={props.testId}
      class={`flex gap-4 ${props.class ?? ""}`}
      aria-label="Social links"
    >
      <For each={props.links}>
        {(link) => (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            title={link.label}
            aria-label={link.label}
            class={`flex items-center justify-center bg-[var(--ks-surface-raised,#1a1a1a)] text-[var(--ks-fg-muted,#a1a1aa)] transition-all hover:bg-[var(--ks-accent,#fbbf24)] hover:text-[var(--ks-fg-on-accent,#0a0a0a)] ${shapeClass()}`}
            style={{ width: `${btn()}px`, height: `${btn()}px` }}
          >
            {link.icon({ size: icon() })}
          </a>
        )}
      </For>
    </nav>
  );
}
