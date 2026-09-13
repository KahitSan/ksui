---
"@kahitsan/ksui": minor
---

TransactionForm: add optional `allowPayable` prop (default `true`). Consumers that no longer create payable-category transactions pass `allowPayable={false}` to hide the Payable category tab; editing an existing payable row still shows the payable pane.
