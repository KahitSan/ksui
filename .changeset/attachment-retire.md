---
"@kahitsan/kplugin_transactions": patch
---

A1 retire for transaction attachments (financial documents — receipts/invoices). Uploads now go to the private bucket (acl: private) and are served only through a new ownership-scoped presigned-URL route (GET /:id/attachments/:aid/presign), using the kernel's now-native S3 presign; the UI fetches a short-lived presigned URL per attachment instead of the bare public s3_link. Closes a world-readable exposure of financial-document attachments. (Self-presign of the plugin's own object via s3PresignUrl — simpler than the kernel-ledger indirection; asset_id wiring deferred. Retiring existing objects' CDN-cached public copies is a follow-on Spaces CDN purge, as with FA.)
