import { Show, type JSX } from "solid-js";

/** Horizontal alignment for the whole heading block. */
export type SectionHeadingAlign = "left" | "center" | "right";

/** Heading level rendered for the title element. */
export type SectionHeadingLevel = "h1" | "h2" | "h3";

export interface SectionHeadingProps {
  /**
   * Title content. Accept JSX so a caller can apply its own brand styling
   * (e.g. a gradient span) on part of the title without this component
   * carrying any site-specific CSS.
   */
  title: JSX.Element;
  /** Small uppercase, wide-tracked label above the title (the "eyebrow"). */
  kicker?: string;
  /** Supporting copy below the title. Accepts JSX for richer content. */
  subtitle?: JSX.Element;
  /**
   * Show a short underline accent bar below the title. The bar inherits the
   * accent color; override with `accentClass`.
   */
  accent?: boolean;
  /** Tailwind class controlling the accent bar color. */
  accentClass?: string;
  /** Tailwind class controlling the kicker color. */
  kickerClass?: string;
  /** Tailwind class controlling the title color. */
  titleClass?: string;
  /** Tailwind class controlling the subtitle color. */
  subtitleClass?: string;
  /** Block alignment. Defaults to "left". */
  align?: SectionHeadingAlign;
  /** Title element tag. Defaults to "h2". */
  as?: SectionHeadingLevel;
  /** Extra classes on the outer wrapper. */
  class?: string;
}

const ALIGN_WRAP: Record<SectionHeadingAlign, string> = {
  left: "text-left items-start",
  center: "text-center items-center",
  right: "text-right items-end",
};

// Per-level title sizing. Domain-free defaults; callers override via titleClass.
const TITLE_SIZE: Record<SectionHeadingLevel, string> = {
  h1: "text-3xl md:text-4xl lg:text-6xl font-bold tracking-tight",
  h2: "text-2xl md:text-3xl lg:text-4xl font-bold",
  h3: "text-xl md:text-2xl font-bold",
};

/**
 * A recurring section header block: an optional uppercase kicker, a title
 * (any JSX, so the caller can apply brand-specific styling), an optional
 * underline accent bar, and optional subtitle copy.
 *
 * Presentational only. No site copy, no domain coupling — every piece of text
 * and color comes from props.
 */
export default function SectionHeading(props: SectionHeadingProps): JSX.Element {
  const align = () => props.align ?? "left";
  const level = () => props.as ?? "h2";

  const Title = (titleProps: { class: string; children: JSX.Element }): JSX.Element => {
    const tag = level();
    if (tag === "h1") return <h1 class={titleProps.class}>{titleProps.children}</h1>;
    if (tag === "h3") return <h3 class={titleProps.class}>{titleProps.children}</h3>;
    return <h2 class={titleProps.class}>{titleProps.children}</h2>;
  };

  return (
    <div class={`flex flex-col ${ALIGN_WRAP[align()]} ${props.class ?? ""}`}>
      <Show when={props.kicker}>
        <div
          class={`text-xs font-bold tracking-[0.3em] uppercase mb-2 ${
            props.kickerClass ?? "text-amber-500"
          }`}
        >
          {props.kicker}
        </div>
      </Show>

      <Title class={`${TITLE_SIZE[level()]} ${props.titleClass ?? "text-white"}`}>
        {props.title}
      </Title>

      <Show when={props.accent}>
        <div class={`w-20 h-1 mt-4 rounded-full ${props.accentClass ?? "bg-amber-500"}`} />
      </Show>

      <Show when={props.subtitle}>
        <p class={`mt-4 text-base md:text-lg max-w-2xl ${props.subtitleClass ?? "text-zinc-400"}`}>
          {props.subtitle}
        </p>
      </Show>
    </div>
  );
}
