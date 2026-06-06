---
"@kahitsan/kplugin_transactions": patch
---

Replace the in-repo CI/Release/Deploy workflow logic with thin caller stubs of the reusable workflows in KahitSan/kplugin-workflows. No runtime behavior change; the patch bump exercises the new release + deploy path end to end.
