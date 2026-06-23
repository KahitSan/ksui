---
"@kahitsan/ksui": minor
---

ResourcePage: forward an optional `pageLength` + `lengthMenu` from the spec to the
list DataTable, so a host can drive the initial rows-per-page (e.g. a resolved
route-settings `pageSize` preference). Additive — omitting them keeps DataTable's
existing defaults (10 / [10, 25, 50, 100]).
