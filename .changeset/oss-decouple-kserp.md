---
"@kahitsan/kplugin_transactions": patch
---

Decouple from the kserp source tree for OSS. The plugin-author surface now resolves via the published `@kahitsan/plugin-sdk` (bumped to `^0.5.1`) instead of `../kserp` tsconfig/vitest paths, and the unused `@ks-erp/kernel` peerDependency is removed. Where they were present, the S3 and test-harness imports are repointed to `@kahitsan/plugin-sdk` (+ `/test`) and the dead Express `Request` augmentation and `express` dependency are dropped (plugins are Hono).
