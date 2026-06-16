---
"@kahitsan/ksui": patch
---

Add a `./components/*` subpath export. Non-host consumers (e.g. the kahitsan-web
marketing site) can now import a single standalone primitive —
`@kahitsan/ksui/components/base/Button` — without resolving the barrel
(`.`), which re-exports host-coupled components that import `@kserp/host-ui`.
