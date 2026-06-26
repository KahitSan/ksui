---
"@kahitsan/ksui": minor
---

Add `createObjectUrlResource(href, { init })` — a SolidJS primitive that fetches an authed same-origin route and exposes the bytes as an object URL (`blob:`) for `<img src>` / `<a href>`, revoking the URL on change and on cleanup. This is the proxy/blob pattern for privately-stored assets: the storage origin is never exposed and there is no leakable signed bearer URL. Domain-free — the consumer supplies the href and any headers.
