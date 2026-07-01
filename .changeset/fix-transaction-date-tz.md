---
"@kahitsan/kplugin_transactions": patch
---

fix: payroll salary attachments + Manila transaction date

- `createSalaryTransaction` no longer takes any attachment payload. It used to
  accept base64 files (forced through the kernel RPC's JSON body, broke on size);
  that path is removed. The timesheets Pay flow now uploads receipts directly via
  the standard multipart `POST /:id/attachments` S3 route after the salary is
  created, so the RPC only records the expense.
- The list and detail queries used `SELECT t.*`, so the `date`-typed
  `transaction_date` serialized via `.toISOString()` to the previous UTC day
  (a Jul 1 payment showed as Jun 30). Both now override it with
  `to_char(t.transaction_date, 'YYYY-MM-DD')` — the intended calendar date.
- The dead-blob-attachment migration guards on `file_path` existing before
  querying it, so it no longer crash-loops the plugin when the column is absent.
