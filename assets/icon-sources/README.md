# Original icon artwork

The active artwork uses the approved V4 Refined Solid seed and purpose-derived V4 families. These source atlases were generated with the built-in GPT Image tool. Each new family has its exact prompt, source hash, and technical QA record. No third-party icon paths were traced or incorporated.

`manifest.json` maps each selected atlas cell to its semantic name. It selects 128 cells: 125 source designs and three required visual states. The public artwork contract records the required names and runtime aliases/rotations. The seed contributes 13 cells; two alternate BIR cells and the generic tax-document cell are unselected. `bir-office` is an explicit BIR office identity, not an official seal. The generic `tax-document` remains a separate legacy design.

Old controls, family, and variants atlases remain historical provenance. `manifest-v1-historical.json` records their former assignments. The earlier 167-cell generation plan is superseded by `v4-purpose-generation-plan.json`. Unused public exports retain their legacy artwork; they do not trigger new generation. Package/service identity uses one neutral default. Revenue artwork represents sales, not a shopping bag.

Source masters remain unchanged. White-background QA copies support visual inspection and are never export masters. The first V4 family retains its initial padding-only rejection record and a separate accepted review. The measured clear boundary passed the production crop requirement. Explicit row boundaries in two families keep all artwork inside its selected cell without changing source pixels.

Run `npm run build:icons` to extract, normalize and resize the transparent artwork into individual 144-pixel alpha masks. Source masters stay unchanged. Exports and measurements are written under `assets/icon-exports`; selectively imported source modules are written under `src/icons`.

Resizing is a deliberate export step, not a lossless operation. The encoder compares every output alpha value after PNG encoding and falls back from palette encoding when needed. The generated metrics record each crop, output size, byte count, and encoding result. Browser comparisons at actual display sizes validate the resize separately.

The exporter also compares vector traces at 8–54 pixels and device-pixel ratios of one through three. It retains raster delivery when mean alpha error exceeds the configured bound in any case, or when tracing does not reduce size. Metrics retain every comparison; they do not establish perceptual equivalence by themselves.

The runtime imports individual glyph modules and does not load complete atlases. It can deliver selected PNG masks as asset URLs; common initial-navigation masks can remain inline. Native SVG paths and alpha masks apply the caller's current color, accessible name, dimensions, and interaction attributes. Bundler and remote-asset requirements are documented with the renderer.
