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

The Star includes a distinct filled rendition. Its fill inherits the SVG fill value, including CSS classes. Use `fill="currentColor"` to show the filled rendition.

Check and CircleCheck include a heavier rendition. Select it with `weight="bold"`; compatibility values `strokeWidth={3}` or `stroke-width={2.6}` also select that supplied rendition. Bitmap artwork has fixed geometry. Arbitrary SVG stroke widths and path edits do not change its outline.

Dynamic consumers can import `isIconName` and `loadIcon` from `@kahitsan/ksui/icons/registry`. The registry recognizes the finite published set and retained semantic aliases. Unknown names return `null`; the caller chooses its fallback. Input is not used to construct arbitrary import paths. Applications that need only a small configured set can use explicit imports instead of the full registry.

Selected artwork is delivered as a native vector path when its size comparisons pass. Finer artwork retains a lossless PNG alpha mask. A small first-paint navigation set is embedded; other PNGs use emitted asset URLs and browser caching. No font or source atlas is decoded at runtime.

Raster imports use Vite's `?url&no-inline` asset support. Vite 6 builds are verified. Consumers must serve the emitted image files alongside their JavaScript. For an IIFE remote served from a nested path, set `base: "./"` so image URLs resolve relative to its script, rather than the host's root. Server-rendered builds must also pass these source imports through the bundler; importing raw PNG modules directly in Node is unsupported. A restrictive content security policy must permit same-origin images and `data:` images for embedded fallbacks.

Directional components share an original source design with an intrinsic rotation. The public component name keeps its direction, and caller SVG transforms still apply. Existing public exports outside the refreshed set remain available. `Sales` provides a revenue meaning; `ShoppingBag` retains its existing public artwork.

BIR document identities are available as `BirForm2307`, `BirForm0619E`, and `BirForm1601Eq`, or their `bir-form-*` deep imports. Use a visible form label or accessible name with each document identity.
