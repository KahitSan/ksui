---
"@kahitsan/ksui": minor
---

ExistingAttachmentTile gains an optional `rawHref` (+ `rawInit`) prop for the proxy/blob source mode: when set, it streams the private object's bytes from that authed same-origin route (via createObjectUrlResource) and renders the resulting blob: with a loading spinner, instead of resolving the public s3_link. Backward-compatible — existing s3_link consumers are unaffected.
