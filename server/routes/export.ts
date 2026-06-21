// CSV export routes for the transactions router.
//
//   GET    /export                    recent jobs for this user (≤24h, mapped to
//                                      the modal's RecentJob shape)
//   POST   /export                    create a job + kick off the async CSV
//                                      worker, returns { jobId }
//   GET    /export/:jobId/progress    SSE stream that polls the job row and emits
//                                      progress / done / error frames
//   GET    /export/:jobId/download    stream the finished CSV back (authenticated)
//
// The export file lives in S3-compatible object storage ONLY (DO Spaces in prod,
// MinIO in dev/CI) — never on this server's disk, mirroring the attachment model.
// Unlike a single attachment, a date-range export is a BULK dump of an org's
// financial rows, so the object is uploaded PRIVATE (not public-read) and served
// back only through the authenticated /download route below — never at a
// world-readable URL. Job state lives in accounts.export_jobs (created by the
// 20260528 prod-compat migration); file_path holds the S3 object key.
//
// Every query carries WHERE workspace_id = $N (+ the per-user privacyClause that
// every list-style read reuses), so an export can never include rows the
// requester can't already see in the list. Voided rows are excluded.

import { type Router, type Request, type Response, type RequestHandler } from "express";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { identityHeaderOf } from "@kahitsan/plugin-sdk";
import { s3Enabled, s3PutObject, s3GetObject, s3DeleteObject } from "@kahitsan/plugin-server-utils";
import { privacyClause, isValidIsoDate, resolveUserNames } from "./shared.js";
import { findAccountsByIds, findPayeesByIds, type IdentityHeader } from "../lib/peers.js";

// Mirrors the modal's EXPORT_MAX_RANGE_DAYS so the server enforces the same cap
// the UI advertises (the UI gate is a courtesy; this one is the real limit).
const EXPORT_MAX_RANGE_DAYS = 730;
const PAGE_SIZE = 500; // rows fetched per progress tick
const SSE_POLL_MS = 600;
const SSE_MAX_MS = 5 * 60 * 1000; // safety cap so a wedged job can't hold the stream open forever

export type ExportRouteCtx = {
  pool: PluginDb;
  requireAuth: RequestHandler;
  requireWorkspace: RequestHandler;
  requirePermission: (...codes: string[]) => RequestHandler;
};

// ── CSV helpers ────────────────────────────────────────────────────────────
// Quote per RFC 4180 AND neutralise formula injection: a cell beginning with
// = + - @ (or a tab/CR) is prefixed with a single quote so spreadsheet apps
// don't evaluate it as a formula when the file is opened.
function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

// A safe filename for the Content-Disposition header: drop quotes / control
// chars / path separators so the stored value can't break out of the header.
function sanitizeFilename(name: string | null): string {
  const base = (name || "transactions-export.csv").replace(/[^\w.\- ]+/g, "_");
  return base.length > 0 ? base : "transactions-export.csv";
}

function rangeSpanInDays(from: string, to: string): number {
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((t - f) / 86_400_000) + 1;
}

function s3KeyForJob(workspaceId: number | string | undefined, jobId: string): string {
  return `exports/transactions/${workspaceId}/${jobId}.csv`;
}

type RowFilters = {
  workspaceId: number | string | undefined;
  dateFrom: string;
  dateTo: string;
  // The privacy fragment + its params, resolved once at request time from the
  // requester's identity (the worker runs after the response is sent, so it
  // can't re-read req — we snapshot what privacyClause needs here).
  privacy: { frag: string | null; params: unknown[] };
};

// ── The async worker ────────────────────────────────────────────────────────
// Runs fire-and-forget after POST responds. Writes progress + the terminal
// status straight to the job row, which both the SSE stream and the recent-jobs
// list read from. A plugin restart mid-run leaves the row 'running' until it
// expires — the user simply retries; no partial file is ever served (download
// gates on status='done').
async function runExportJob(
  pool: PluginDb,
  jobId: string,
  consolidate: boolean,
  filters: RowFilters,
  identityHeader: IdentityHeader,
): Promise<void> {
  const key = s3KeyForJob(filters.workspaceId, jobId);
  try {
    await pool.query(
      `UPDATE accounts.export_jobs SET status = 'running', updated_at = now() WHERE id = $1`,
      [jobId],
    );

    const csv = consolidate
      ? await buildConsolidatedCsv(pool, jobId, filters)
      : await buildDetailedCsv(pool, jobId, filters, identityHeader);

    const buf = Buffer.from(csv.text, "utf8");
    await s3PutObject(key, buf, "text/csv; charset=utf-8", { acl: "private" });

    const filename = `transactions-${filters.dateFrom}-to-${filters.dateTo}${consolidate ? "-daily" : ""}.csv`;
    try {
      await pool.query(
        `UPDATE accounts.export_jobs
            SET status = 'done', row_count = $2, byte_size = $3, filename = $4,
                file_path = $5, progress_done = progress_total, updated_at = now()
          WHERE id = $1`,
        [jobId, csv.rowCount, buf.length, filename, key],
      );
    } catch (dbErr) {
      // Don't strand an object we can no longer reference from the job row.
      await s3DeleteObject(key).catch(() => {});
      throw dbErr;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    await pool
      .query(
        `UPDATE accounts.export_jobs SET status = 'error', error_message = $2, updated_at = now() WHERE id = $1`,
        [jobId, message.slice(0, 500)],
      )
      .catch(() => {});
    console.error(`[transactions] export job ${jobId} failed:`, err);
  }
}

function whereForFilters(filters: RowFilters, extra: string): { sql: string; params: unknown[] } {
  const params: unknown[] = [filters.workspaceId, filters.dateFrom, filters.dateTo];
  const conditions = [
    "t.workspace_id = $1",
    "t.transaction_date >= $2",
    "t.transaction_date <= $3",
    "t.status <> 'voided'",
    extra,
  ].filter(Boolean);
  if (filters.privacy.frag) {
    // privacyClause was built against startIdx 4 (see registerExportRoutes).
    conditions.push(filters.privacy.frag);
    params.push(...filters.privacy.params);
  }
  return { sql: `WHERE ${conditions.join(" AND ")}`, params };
}

async function buildConsolidatedCsv(
  pool: PluginDb,
  jobId: string,
  filters: RowFilters,
): Promise<{ text: string; rowCount: number }> {
  const { sql, params } = whereForFilters(filters, "t.category = 'sale'");
  const result = await pool.query(
    `SELECT to_char(t.transaction_date, 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS sales_count,
            SUM(t.amount)::numeric(14,2) AS total_amount
       FROM accounts.transactions t
       ${sql}
      GROUP BY t.transaction_date
      ORDER BY t.transaction_date ASC`,
    params,
  );
  let text = csvRow(["Date", "Sales Count", "Total Amount"]);
  for (const r of result.rows) {
    text += csvRow([r.day, r.sales_count, r.total_amount]);
  }
  await pool.query(
    `UPDATE accounts.export_jobs SET progress_total = $2, progress_done = $2, updated_at = now() WHERE id = $1`,
    [jobId, result.rows.length],
  );
  return { text, rowCount: result.rows.length };
}

interface DetailRow {
  id: number;
  transaction_date: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  notes: string | null;
  amount: string;
  status: string;
  payment_status: string | null;
  amount_collected: string;
  balance: string;
  source_account_id: number | null;
  destination_account_id: number | null;
  payee_id: number | null;
  created_by: string | null;
  created_at_local: string;
}

async function buildDetailedCsv(
  pool: PluginDb,
  jobId: string,
  filters: RowFilters,
  identityHeader: IdentityHeader,
): Promise<{ text: string; rowCount: number }> {
  const { sql, params } = whereForFilters(filters, "");

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM accounts.transactions t ${sql}`,
    params,
  );
  const total: number = countResult.rows[0]?.total ?? 0;
  await pool.query(
    `UPDATE accounts.export_jobs SET progress_total = $2, progress_done = 0, updated_at = now() WHERE id = $1`,
    [jobId, total],
  );

  const rows: DetailRow[] = [];
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const pageParams = [...params, PAGE_SIZE, offset];
    const li = params.length;
    const page = await pool.query(
      `SELECT t.id, to_char(t.transaction_date, 'YYYY-MM-DD') AS transaction_date,
              t.category, t.subcategory, t.description, t.notes, t.amount, t.status,
              t.source_account_id, t.destination_account_id, t.payee_id, t.created_by,
              to_char((t.created_at AT TIME ZONE 'Asia/Manila'), 'YYYY-MM-DD HH24:MI') AS created_at_local,
              paid.total_paid::numeric(12,2) AS amount_collected,
              (t.amount - paid.total_paid)::numeric(12,2) AS balance,
              CASE
                WHEN t.category <> 'sale' THEN NULL
                WHEN t.amount = 0 THEN 'paid'
                WHEN paid.total_paid >= t.amount THEN 'paid'
                WHEN paid.total_paid > 0 THEN 'partial'
                ELSE 'unpaid'
              END AS payment_status
         FROM accounts.transactions t
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(tp.amount), 0)::numeric(12,2) AS total_paid
             FROM accounts.transaction_payments tp WHERE tp.transaction_id = t.id
         ) paid ON true
         ${sql}
        ORDER BY t.transaction_date ASC, t.id ASC
        LIMIT $${li + 1} OFFSET $${li + 2}`,
      pageParams,
    );
    rows.push(...(page.rows as DetailRow[]));
    await pool.query(
      `UPDATE accounts.export_jobs SET progress_done = $2, updated_at = now() WHERE id = $1`,
      [jobId, rows.length],
    );
  }

  // Batch-resolve cross-plugin names once (graceful degradation: a missing peer
  // plugin yields null → the cell is left blank, matching the list view).
  const accountIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.source_account_id, r.destination_account_id])
        .filter((v): v is number => v != null),
    ),
  ];
  const payeeIds = [...new Set(rows.map((r) => r.payee_id).filter((v): v is number => v != null))];
  const userIds = new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v));

  const [accounts, payees, userMap] = await Promise.all([
    accountIds.length ? findAccountsByIds(accountIds, identityHeader) : Promise.resolve([]),
    payeeIds.length ? findPayeesByIds(payeeIds, identityHeader) : Promise.resolve([]),
    resolveUserNames(pool, userIds),
  ]);
  const accountName = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const payeeName = new Map((payees ?? []).map((p) => [p.id, p.name]));

  let text = csvRow([
    "Date", "Category", "Subcategory", "Description", "Amount", "Status",
    "Payment Status", "Amount Collected", "Balance", "Source Account",
    "Destination Account", "Payee", "Created By", "Created At", "Notes",
  ]);
  for (const r of rows) {
    text += csvRow([
      r.transaction_date,
      r.category,
      r.subcategory,
      r.description,
      r.amount,
      r.status,
      r.payment_status,
      r.amount_collected,
      r.balance,
      r.source_account_id != null ? (accountName.get(r.source_account_id) ?? "") : "",
      r.destination_account_id != null ? (accountName.get(r.destination_account_id) ?? "") : "",
      r.payee_id != null ? (payeeName.get(r.payee_id) ?? "") : "",
      r.created_by ? (userMap.get(r.created_by)?.name ?? "") : "",
      r.created_at_local,
      r.notes,
    ]);
  }
  return { text, rowCount: rows.length };
}

export function registerExportRoutes(router: Router, ctx: ExportRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  // ── Recent jobs (powers the modal's "Recent exports" list) ───────────────
  router.get(
    "/export",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT id, status, consolidate, row_count, byte_size, filename, error_message,
                  to_char(date_from, 'YYYY-MM-DD') AS date_from,
                  to_char(date_to, 'YYYY-MM-DD') AS date_to,
                  created_at, expires_at
             FROM accounts.export_jobs
            WHERE workspace_id = $1 AND user_id = $2 AND expires_at > now()
            ORDER BY created_at DESC
            LIMIT 20`,
          [req.workspaceId, req.user?.id ?? ""],
        );
        res.json({ jobs: result.rows });
      } catch (err) {
        console.error("[transactions] export list error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ── Create a job ─────────────────────────────────────────────────────────
  router.post(
    "/export",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as {
        dateFrom?: unknown;
        dateTo?: unknown;
        consolidate?: unknown;
      };
      const dateFrom = String(body.dateFrom ?? "");
      const dateTo = String(body.dateTo ?? "");
      const consolidate = body.consolidate === true;

      if (!isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) {
        res.status(400).json({ error: "dateFrom and dateTo must be YYYY-MM-DD" });
        return;
      }
      if (dateFrom > dateTo) {
        res.status(400).json({ error: "dateFrom must be on or before dateTo" });
        return;
      }
      if (rangeSpanInDays(dateFrom, dateTo) > EXPORT_MAX_RANGE_DAYS) {
        res.status(400).json({ error: `Range may not exceed ${EXPORT_MAX_RANGE_DAYS} days` });
        return;
      }
      if (!s3Enabled()) {
        res.status(503).json({ error: "Export storage is not configured" });
        return;
      }

      try {
        const inserted = await pool.query(
          `INSERT INTO accounts.export_jobs
             (workspace_id, user_id, kind, date_from, date_to, consolidate, status)
           VALUES ($1, $2, 'transactions', $3, $4, $5, 'pending')
           RETURNING id`,
          [req.workspaceId, req.user?.id ?? "", dateFrom, dateTo, consolidate],
        );
        const jobId: string = inserted.rows[0].id;

        // Snapshot what the worker needs from the request — it runs after this
        // response is sent, so it must not close over req for later reads.
        const privacyParams: unknown[] = [];
        const frag = privacyClause(req, privacyParams, 4); // $1-$3 are ws/from/to
        const filters: RowFilters = {
          workspaceId: req.workspaceId,
          dateFrom,
          dateTo,
          privacy: { frag, params: privacyParams },
        };
        const identityHeader = identityHeaderOf(req);

        void runExportJob(pool, jobId, consolidate, filters, identityHeader);
        res.json({ jobId });
      } catch (err) {
        console.error("[transactions] export create error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // ── Progress (SSE) ───────────────────────────────────────────────────────
  router.get(
    "/export/:jobId/progress",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      const jobId = req.params.jobId;
      const own = await pool.query(
        `SELECT 1 FROM accounts.export_jobs WHERE id = $1 AND workspace_id = $2`,
        [jobId, req.workspaceId],
      );
      if (own.rows.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.write(": open\n\n");

      let finished = false;
      let endTimer: NodeJS.Timeout | undefined;
      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const stopTimers = () => {
        clearInterval(timer);
        if (endTimer) clearTimeout(endTimer);
      };
      // Stop polling and emit the terminal frame, but do NOT close the socket
      // immediately — closing the instant after the final write races the
      // browser's EventSource parser, which can drop the terminal event and
      // fire 'error' (then reconnect) instead. The client closes the stream
      // itself on 'done'/'error' (→ req 'close' → stopTimers); this grace
      // backstop ends it if the client lingers.
      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        endTimer = setTimeout(() => res.end(), 1500);
      };

      const startedAt = Date.now();
      const poll = async () => {
        if (finished) return;
        try {
          const r = await pool.query(
            `SELECT status, progress_done, progress_total, filename, error_message
               FROM accounts.export_jobs WHERE id = $1 AND workspace_id = $2`,
            [jobId, req.workspaceId],
          );
          const job = r.rows[0] as
            | {
                status: string;
                progress_done: number;
                progress_total: number;
                filename: string | null;
                error_message: string | null;
              }
            | undefined;
          if (!job) {
            send("error", { message: "Export job not found" });
            finish();
            return;
          }
          send("progress", {
            done: job.progress_done,
            total: job.progress_total,
            status: job.status,
          });
          if (job.status === "done") {
            send("done", {
              filename: job.filename,
              downloadUrl: `/api/transactions/export/${jobId}/download`,
            });
            finish();
          } else if (job.status === "error" || job.status === "expired") {
            send("error", { message: job.error_message ?? "Export failed" });
            finish();
          } else if (Date.now() - startedAt > SSE_MAX_MS) {
            send("error", { message: "Export timed out — please retry." });
            finish();
          }
        } catch (err) {
          console.error("[transactions] export progress poll error:", err);
          send("error", { message: "Export failed" });
          finish();
        }
      };

      const timer = setInterval(() => void poll(), SSE_POLL_MS);
      // Client closed the stream (normal path after 'done'/'error', or navigated
      // away): drop all timers and let the socket go — nothing more to send.
      req.on("close", () => {
        finished = true;
        stopTimers();
      });
      void poll();
    },
  );

  // ── Download the finished CSV (authenticated stream from private storage) ──
  router.get(
    "/export/:jobId/download",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const r = await pool.query(
          `SELECT status, file_path, filename
             FROM accounts.export_jobs
            WHERE id = $1 AND workspace_id = $2 AND expires_at > now()`,
          [req.params.jobId, req.workspaceId],
        );
        const job = r.rows[0] as
          | { status: string; file_path: string | null; filename: string | null }
          | undefined;
        if (!job) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        if (job.status !== "done" || !job.file_path) {
          res.status(409).json({ error: "Export is not ready" });
          return;
        }
        const { body, contentType } = await s3GetObject(job.file_path);
        res.setHeader("Content-Type", contentType || "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${sanitizeFilename(job.filename)}"`,
        );
        res.setHeader("Content-Length", String(body.length));
        res.send(body);
      } catch (err) {
        console.error("[transactions] export download error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );
}
