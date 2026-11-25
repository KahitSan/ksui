/// <reference path="./asset-modules.d.ts" />
import {
  Show,
  createUniqueId,
  splitProps,
  type Component,
  type JSX,
} from "solid-js";

export type IconProps = JSX.SvgSVGAttributes<SVGSVGElement> & {
  size?: number | string;
  transform?: string;
  title?: string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
  weight?: "regular" | "bold";
};

export type ArtworkIconComponent = Component<IconProps>;

export type ArtworkSource = string | { readonly image: string };

export interface ArtworkVariants {
  bold?: ArtworkSource;
  filled?: ArtworkSource;
  /** Intrinsic source orientation; native SVG transforms remain caller-controlled. */
  rotation?: number;
}

function ArtworkLayer(props: { source: ArtworkSource; id: string; fill: string }) {
  const imageSource = () => typeof props.source === "string" ? props.source : props.source.image;
  return (
    <Show
      when={typeof props.source !== "string" || props.source.startsWith("data:")}
      fallback={
        <path
          d={typeof props.source === "string" ? props.source : ""}
          fill={props.fill}
          fill-rule="evenodd"
          stroke="none"
        />
      }
    >
      <defs>
        <mask
          id={props.id}
          x="0"
          y="0"
          width="144"
          height="144"
          maskUnits="userSpaceOnUse"
          style={{ "mask-type": "alpha" }}
        >
          <image href={imageSource()} x="0" y="0" width="144" height="144" />
        </mask>
      </defs>
      <rect
        width="144"
        height="144"
        fill={props.fill}
        stroke="none"
        mask={`url(#${props.id})`}
      />
    </Show>
  );
}

function accessibility(props: IconProps, titleId: string) {
  const labelled = Boolean(
    props.title || props["aria-label"] || props["aria-labelledby"]
  );
  return {
    role: props.role ?? (labelled ? "img" : undefined),
    "aria-label": props["aria-label"],
    "aria-labelledby":
      props["aria-labelledby"] ?? (props.title ? titleId : undefined),
    "aria-hidden": props["aria-hidden"] ?? (labelled ? undefined : true),
  } as const;
}

/** Render original generated artwork while retaining native SVG component props. */
export function createArtworkIcon(
  name: string,
  source: ArtworkSource,
  variants: ArtworkVariants = {}
): ArtworkIconComponent {
  return function ArtworkIcon(props) {
    const [local, rest] = splitProps(props, [
      "size",
      "width",
      "height",
      "title",
      "children",
      "fill",
      "role",
      "aria-hidden",
      "aria-label",
      "aria-labelledby",
      "strokeWidth",
      "stroke-width",
      "absoluteStrokeWidth",
      "weight",
    ]);
    const id = `artwork-${createUniqueId()}`;
    const titleId = `${id}-title`;
    const artwork = () => {
      const width = Number(local.strokeWidth ?? local["stroke-width"] ?? 2);
      return variants.bold && (local.weight === "bold" || width >= 2.6)
        ? variants.bold
        : source;
    };
    return (
      <svg
        {...rest}
        {...accessibility(local, titleId)}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 144 144"
        width={local.width ?? local.size ?? 24}
        height={local.height ?? local.size ?? 24}
        fill={local.fill ?? "none"}
        stroke="none"
        data-icon={name}
      >
        <title id={titleId}>{local.title}</title>
        {local.children}
        <g transform={variants.rotation ? `rotate(${variants.rotation} 72 72)` : undefined}>
          <ArtworkLayer source={artwork()} id={id} fill="currentColor" />
          {variants.filled && (
            <ArtworkLayer
              source={variants.filled}
              id={`${id}-filled`}
              fill="inherit"
            />
          )}
        </g>
      </svg>
    );
  };
}
