---
"@kahitsan/kplugin_transactions": minor
---

Expose a `createSalaryTransaction` cross-plugin service that records a private "Salary - Direct" expense (director + accountant visibility, non-VAT) for the timesheets payroll flow. Extracts the shared transaction-insert helper so the service and the HTTP create route build the row identically.
