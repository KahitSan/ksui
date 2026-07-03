---
"@kahitsan/ksui": minor
---

Add `uploadPendingFiles` to `pending-file` utils — the shared best-effort multipart upload to the transactions plugin's `POST /:id/attachments` route, extracted from the three plugin-local copies (transactions, counter, timesheets/payroll) so attachment upload has one canonical implementation.
