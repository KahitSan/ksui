# Original icon artwork

These source atlases were generated with the built-in GPT Image tool. Each atlas has its own retained prompt. The first controls atlas supplied a visual reference for subsequent generations. No third-party icon paths were traced or incorporated.

`manifest.json` maps each atlas cell to its semantic name. The custom tax-document artwork is a generic form, not an agency seal. The code-hosting artwork is a generic source-control mark, not a platform logo.

Run `npm run build:icons` to extract, normalize and resize the transparent artwork into individual 144-pixel alpha masks. Source masters stay unchanged. Exports and measurements are written under `assets/icon-exports`; selectively imported source modules are written under `src/icons`.

Resizing is a deliberate export step, not a lossless operation. The encoder compares every output alpha value after PNG encoding and falls back from palette encoding when needed. The generated metrics record each crop, output size, byte count, and encoding result. Browser comparisons at actual display sizes validate the resize separately.

The exporter also compares vector traces at 8–54 pixels and device-pixel ratios of one through three. It retains raster delivery when mean alpha error exceeds the configured bound in any case, or when tracing does not reduce size. Metrics retain every comparison; they do not establish perceptual equivalence by themselves.

The runtime embeds each selected path or PNG in its individual module. It does not load complete atlases. Native SVG paths and alpha masks apply the caller's current color, accessible name, dimensions, and interaction attributes.
