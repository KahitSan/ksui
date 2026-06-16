---
"@kahitsan/ksui": patch
---

Add a `./components/*` subpath export. Non-host consumers (e.g. the kahitsan-web
marketing site) can now import a single standalone primitive —
`@kahitsan/ksui/components/base/Button` — without resolving the barrel
(`.`), which re-exports host-coupled components that import `@kserp/host-ui`.

Also relaxes `Button`'s polymorphic `as` prop back to `any` so callers can pass
a component with its own required props (e.g. SolidJS Router's `A`, which
requires `href`); the previous `Component<Record<string, unknown>>` rejected
those `as={A}` usages.
