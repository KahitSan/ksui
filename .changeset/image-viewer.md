---
"@kahitsan/ksui": minor
---

Add `ImageViewer` — a fullscreen image lightbox (Facebook-style): the image centered on a near-opaque backdrop, dismissed by the X button, a backdrop click, or Escape (native `<dialog>` top-layer). ExistingAttachmentTile now uses it: clicking an image attachment opens the viewer instead of a new tab, and a non-image attachment downloads instead of opening a new tab. This is required now that attachments are served as `blob:` object URLs — a `target="_blank"` blob breaks the moment its owning view unmounts and the URL is revoked.
