---
"@kahitsan/ksui": minor
---

Make `ResourcePage` fully transport- and auth-agnostic. The component no longer assumes any app, tenancy, or auth model: the `host` prop now injects a generic `can(permission)` check, a `requestInit()` seam for per-request headers/credentials, a `refetchKey()` trigger, optional `headerActions`, and the `PageShell` layout — replacing the previous host-coupled hooks and the hard-coded tenant header. The `share` field was dropped from `ResourceUiSpec` in favor of `host.headerActions`. The component carries no consumer-specific assumptions.
