---
"@kahitsan/kplugin_transactions": minor
---

Wire the transaction CSV export to S3/MinIO. Adds the job-based export routes (`POST /export`, SSE progress, authenticated streaming `download`, recent-jobs list): the CSV is generated in a background worker, uploaded as a **private** object, and streamed back through an authenticated route (a bulk financial export is never world-readable). Migrates the router to `requireWorkspace` (off the deprecated `requireOrg` alias) and the export modal to the `?wsId` workspace param.
