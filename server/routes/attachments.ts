// Attachment (multipart file upload) routes for the transactions router.
//
// GET /:id/attachments (list metadata), POST /:id/attachments (attach a file via
// multipart field "file"), and DELETE /:id/attachments/:attachmentId (delete an
// attachment). Extracted verbatim from routes.ts so the per-resource route
// modules share one source of truth. This module owns the multer upload config,
// the crypto + node:path imports used to mint the object key, and the S3 client
// helpers — attachment bytes live in S3 only (DO Spaces in prod, MinIO in
// dev/CI), never on this server's disk.
//
// Every query keeps its AND workspace_id = $N / both-sides JOIN workspace scoping
// unchanged.

import { type Router, type Request, type Response, type RequestHandler } from "express";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import multer from "multer";
import crypto from "crypto";
import path from "node:path";
import {
  s3Enabled,
  s3PublicUrl,
  s3PutObject,
  s3DeleteObject,
  s3KeyFromUrl,
  s3PresignUrl,
} from "@kahitsan/plugin-server-utils";

// Presigned-GET lifetime for an attachment (A1 retire): long enough to render an
// inline image / open a PDF, short enough that a leaked URL expires fast.
const ATTACHMENT_PRESIGN_TTL_SECONDS = 300;

// ── Attachment upload config ─────────────────────────────────────────────
// Attachments are stored in S3-compatible object storage ONLY (DO Spaces in
// prod, MinIO in dev/CI) — never on this server's disk. multer buffers the
// upload in memory (≤10MB) and the handler puts it to S3, storing the public
// link in s3_link (the sole reference). The object key is generated per upload
// (`uploads/transactions/<wsId>/<uuid>.<ext>`) and recovered from s3_link via
// s3KeyFromUrl on delete — the legacy file_path column has been dropped.
const ALLOWED_ATTACHMENT_MIMES = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "application/pdf",
];
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_ATTACHMENT_MIMES.includes(file.mimetype));
  },
});

export type AttachmentRouteCtx = {
  pool: PluginDb;
  requireAuth: RequestHandler;
  requireWorkspace: RequestHandler;
  requirePermission: (...codes: string[]) => RequestHandler;
};

export function registerAttachmentRoutes(router: Router, ctx: AttachmentRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  // ── Attachments (multipart file upload) ──────────────────────────────────
  router.get(
    "/:id/attachments",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const rows = await pool.query(
          `SELECT a.id, a.transaction_id, a.file_name, a.file_size, a.mime_type, a.uploaded_by, a.s3_link, a.created_at
             FROM accounts.transaction_attachments a
             JOIN accounts.transactions t ON t.id = a.transaction_id
            WHERE a.transaction_id = $1 AND t.workspace_id = $2 ORDER BY a.created_at`,
          [req.params.id, req.workspaceId],
        );
        res.json({ attachments: rows.rows });
      } catch (err) {
        console.error("[transactions] attachments list error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  // GET /:id/attachments/:attachmentId/presign — A1 retire: a short-lived,
  // ownership-scoped presigned GET URL for one private attachment. The
  // workspace+transaction JOIN scoping IS the access gate (RLS is the second
  // wall); the presigned URL is just a time-limited capability over the private
  // object, so a leaked link expires fast. Explicit whitelist response — no S3
  // key, bucket, or credential leaks.
  router.get(
    "/:id/attachments/:attachmentId/presign",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (req: Request, res: Response) => {
      try {
        const row = await pool.query<{ s3_link: string | null }>(
          `SELECT a.s3_link
             FROM accounts.transaction_attachments a
             JOIN accounts.transactions t ON t.id = a.transaction_id
            WHERE a.id = $1 AND a.transaction_id = $2 AND t.workspace_id = $3`,
          [req.params.attachmentId, req.params.id, req.workspaceId],
        );
        if (row.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        const key = s3KeyFromUrl(row.rows[0].s3_link);
        if (!key) {
          res.status(404).json({ error: "No object" });
          return;
        }
        const url = s3PresignUrl(key, ATTACHMENT_PRESIGN_TTL_SECONDS);
        res.json({
          url,
          expiresAt: new Date(
            Date.now() + ATTACHMENT_PRESIGN_TTL_SECONDS * 1000,
          ).toISOString(),
        });
      } catch (err) {
        console.error("[transactions] attachment presign error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.post(
    "/:id/attachments",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    (req: Request, res: Response, next) => {
      const wsId = req.workspaceId!;
      const upload = attachmentUpload.single("file");
      upload(req, res, (err) => {
        if (err) {
          if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
              res.status(413).json({ error: "File too large (max 10MB)" });
              return;
            }
            res.status(400).json({ error: err.message });
            return;
          }
          res.status(400).json({ error: "File upload failed" });
          return;
        }
        // Normalize: if a file was uploaded via multipart, populate req.body
        // with the metadata the handler expects. The filename keeps the
        // pre-S3 shape (UUID + original extension) and doubles as the S3 key
        // suffix — no bytes ever touch the local disk.
        if (req.file) {
          const filename =
            crypto.randomUUID() + path.extname(req.file.originalname).toLowerCase();
          req.body = {
            file_name: req.file.originalname,
            file_url: `transactions/${wsId}/${filename}`,
            file_size: req.file.size,
            mime_type: req.file.mimetype,
          };
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const { file_name, file_url, file_size, mime_type } = req.body ?? {};
      // Object storage is the only write target for attachment bytes — a
      // metadata-only (JSON) POST would create a row whose link can never
      // resolve, so multipart with an actual file is required.
      if (!req.file) {
        res.status(400).json({ error: "file is required (multipart/form-data)" });
        return;
      }
      if (!s3Enabled()) {
        res.status(503).json({ error: "Attachment storage is not configured" });
        return;
      }
      if (!file_name || typeof file_name !== "string") {
        res.status(400).json({ error: "file_name is required" });
        return;
      }
      if (!file_url || typeof file_url !== "string") {
        res.status(400).json({ error: "file_url is required" });
        return;
      }
      try {
        const tx = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
          [req.params.id, req.workspaceId],
        );
        if (tx.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        // file_url is the generated object path; it builds the S3 key and the
        // public link. It is NOT stored — s3_link is the sole reference now.
        const key = `uploads/${file_url}`;
        // A1 retire: financial-document attachments upload PRIVATE — never
        // world-readable at a guessable URL. They are served only through the
        // ownership-scoped /presign route below. s3_link stays as the object
        // reference (key recovery for presign/delete), not a public read path.
        // TODO(A1 ops): attachment objects uploaded BEFORE this retire stay served
        // from the Spaces CDN until a CDN purge (`doctl compute cdn flush`) — the
        // ACL flip doesn't evict cached copies. New uploads (here) are private.
        await s3PutObject(key, req.file.buffer, mime_type || "application/octet-stream", {
          acl: "private",
        });
        const s3Link = s3PublicUrl(key);
        let result;
        try {
          result = await pool.query(
            `INSERT INTO accounts.transaction_attachments (transaction_id, file_name, file_size, mime_type, uploaded_by, s3_link)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id, transaction_id, file_name, file_size, mime_type, uploaded_by, s3_link, created_at`,
            [
              req.params.id,
              file_name,
              Number.isFinite(file_size) ? file_size : 0,
              mime_type || "application/octet-stream",
              req.user?.id ?? "",
              s3Link,
            ],
          );
        } catch (insertErr) {
          // Don't leave an unreferenced object behind when the row failed.
          await s3DeleteObject(key).catch(() => {});
          throw insertErr;
        }
        res.status(201).json(result.rows[0]);
      } catch (err) {
        console.error("[transactions] attachment create error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  router.delete(
    "/:id/attachments/:attachmentId",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (req: Request, res: Response) => {
      try {
        const result = await pool.query(
          `DELETE FROM accounts.transaction_attachments a
             USING accounts.transactions t
            WHERE a.transaction_id = t.id
              AND a.id = $1 AND a.transaction_id = $2 AND t.workspace_id = $3
            RETURNING a.id, a.s3_link`,
          [req.params.attachmentId, req.params.id, req.workspaceId],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        // Remove the stored object too — best-effort (the row is already gone;
        // a failed cleanup must not turn the delete into a 500). The object key
        // is derived from s3_link; a legacy row could share an s3_link, so the
        // object is only removed when no other row still references it.
        const { s3_link } = result.rows[0] as { s3_link: string | null };
        const key = s3KeyFromUrl(s3_link);
        if (key) {
          const stillReferenced = await pool.query(
            `SELECT 1 FROM accounts.transaction_attachments WHERE s3_link = $1 LIMIT 1`,
            [s3_link],
          );
          if (stillReferenced.rows.length === 0) {
            await s3DeleteObject(key).catch((cleanupErr) => {
              console.warn(`[transactions] s3 cleanup failed for ${key}:`, cleanupErr);
            });
          }
        }
        res.status(204).send();
      } catch (err) {
        console.error("[transactions] attachment delete error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );
}
