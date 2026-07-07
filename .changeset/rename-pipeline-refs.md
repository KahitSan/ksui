---
"@kahitsan/kplugin_finance": patch
---

chore: update pipeline + docs refs from `transactions` → `finance` after the July 2026 identity rename

- `.github/workflows/deploy.yml` — `plugin-name` and `concurrency.group` now use `finance` (renames the prod `/opt/kserp/plugins/<name>` dir + the pm2 process to match the manifest identity)
- `package.json` description refreshed
- `README.md` code snippets use the current repo name
