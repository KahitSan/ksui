# Original icons

Import only the icons you use:

```tsx
import Search from "@kahitsan/ksui/icons/search";

<button aria-label="Search">
  <Search size={20} />
</button>;
```

Named imports are also available from `@kahitsan/ksui/icons`. A tree-shaking bundler can discard unused icon modules.

The components retain an SVG root. `size`, `width`, `height`, `class`, `classList`, SVG refs, style, events, and accessible attributes remain available. Artwork uses `currentColor`, so normal text and theme colors apply. Icons are decorative by default. Supply `title` or an accessible label when the image itself conveys information.

The Star includes an outlined and filled rendition. Its fill inherits the SVG fill value, including CSS classes. Use `fill="currentColor"` to show the filled rendition.

Check and CircleCheck include a heavier rendition. Select it with `weight="bold"`; compatibility values `strokeWidth={3}` or `stroke-width={2.6}` also select that supplied rendition. Bitmap artwork has fixed geometry. Arbitrary SVG stroke widths and path edits do not change its outline.

Dynamic consumers can import `isIconName` and `loadIcon` from `@kahitsan/ksui/icons/registry`. The registry recognizes the finite published set and retained semantic aliases. Unknown names return `null`; the caller chooses its fallback. Input is not used to construct arbitrary import paths.

Selected artwork is delivered as a native vector path when its size comparisons pass. Finer artwork retains an embedded PNG alpha mask. No separate icon request or font is required. A restrictive content security policy must permit `data:` images for raster fallbacks. Original atlases are not decoded by the runtime.
