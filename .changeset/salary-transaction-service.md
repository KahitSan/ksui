---
"@kahitsan/kplugin_transactions": minor
---

Expose a `createSalaryTransaction` cross-plugin service that records a private "Salary - Direct" expense (director + accountant visibility, non-VAT) for the timesheets payroll flow; extract the shared transaction-insert helper so the service and the HTTP create route build the row identically. Also drop the vendored local `PayeePicker` in favour of the shared `@kahitsan/ksui` one.
