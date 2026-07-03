---
"@kahitsan/kplugin_transactions": patch
---

Fix transactions CSV export progress stream under the Bun runtime. The
`/export/:jobId/progress` SSE route used raw Node `res.write()`, which throws
under Bun + Hono (`c.res` is a Fetch `Response`); rewritten to use Hono's
`streamSSE`. Export now streams progress/done frames and completes.
