---
"@kahitsan/kplugin_transactions": patch
---

Serve transaction attachments via the proxy/blob pattern instead of a presigned URL. The new ownership-scoped `GET /:id/attachments/:attachmentId/raw` route streams the private object's bytes (via s3GetObject) through the authed app route; the UI renders a same-origin `blob:`. No DigitalOcean origin or signed bearer URL ever reaches the browser, and auth/ownership is re-checked on every fetch. Replaces the `/presign` route + resolver, and reuses the ksui `ExistingAttachmentTile` (extended with a `rawHref` blob-source mode) instead of a local fork. Requires `@kahitsan/ksui` ^0.28.0.
