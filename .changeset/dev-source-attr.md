---
"@kahitsan/kplugin_transactions": patch
---

Dev-only build tooling: tag native UI elements with a repo-prefixed `data-source-loc="<repo>/<path>:<line>:<col>"` so DOM elements are attributable to their source repository across the multi-repo UI. Gated on `KSERP_DEV_SOURCE_ATTR=1`; CI/prod builds emit nothing (no runtime change).
