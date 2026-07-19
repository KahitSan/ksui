---
"@kahitsan/ksui": minor
---

`VoucherPicker` accepts an optional `fetchUrl` prop (defaults to `/api/vouchers?status=active&limit=200`) so a consumer without `vouchers.view` can point the picker at a same-shape peer proxy endpoint instead of the vouchers plugin's own API.
