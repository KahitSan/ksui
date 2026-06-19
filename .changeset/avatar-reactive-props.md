---
"@kahitsan/ksui": patch
---

Avatar: keep `name`/`image` reactive (getter-backed) so a live parent rebind re-renders instead of snapshotting at init.
