---
"@kahitsan/kplugin_transactions": patch
---

Consume the shared UI components (MentionTextarea, MarkdownNotes, ClientPicker, VoucherPicker, CameraCapture, AddAttachmentTile) from `@kahitsan/plugin-ui` instead of local byte-identical copies. No behavior change; the built UI bundle is equivalent, with the components' Tailwind classes preserved via an explicit `@source`.
