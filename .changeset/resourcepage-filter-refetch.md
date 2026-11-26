---
"@kahitsan/ksui": patch
---

Fix `ResourcePage` filters not refetching on Solid 2: the table fetches untracked, so filter changes are now part of its refetch key. Document the same rule on `DataTable`'s `refetchKey`.
