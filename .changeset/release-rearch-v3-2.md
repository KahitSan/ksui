---
"@kahitsan/kplugin_transactions": minor
---

Adopt plugin-platform v3.2: migrate routes onto the F3 data surface, bootstrap via `createPluginServer`, author against the single `@kahitsan/plugin-sdk`, consume `@kahitsan/ksui@0.21.0`, rename org→workspace. Declares the IP1 consent edge and exposes `transactions:read` in read-mode (U4 capacity) with a gate-4b smoke test. Drops the decommissioned Playwright e2e suite (CI gates on vitest).
