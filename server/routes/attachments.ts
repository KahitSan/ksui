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

import { Hono, type MiddlewareHandler } from "hono";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { ctxGet } from "../types.js";
import { parseIntParam } from "./shared.js";
import crypto from "crypto";
import path from "node:path";
import {
  s3Enabled,
  s3PublicUrl,
  s3PutObject,
  s3DeleteObject,
  s3KeyFromUrl,
  s3GetObject,
} from "@kahitsan/plugin-sdk";

// How long the browser may cache a streamed attachment. `private` keeps it out of
// shared caches (it's an authed, per-workspace object); 5 min covers a detail-view
// session without re-streaming on every render.
const ATTACHMENT_CACHE_SECONDS = 300;

// ── Attachment upload config ─────────────────────────────────────────────
// Attachments are stored in S3-compatible object storage ONLY (DO Spaces in
// prod, MinIO in dev/CI) — never on this server's disk. multer buffers the
// upload in memory (≤10MB) and the handler puts it to S3, storing the public
// link in s3_link (the sole reference). The object key is generated per upload
// (`uploads/transactions/<wsId>/<uuid>.<ext>`) and recovered from s3_link via
// s3KeyFromUrl on delete — the legacy file_path column has been dropped.

// MIME types accepted for attachment uploads.
const ALLOWED_ATTACHMENT_MIMES = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "application/pdf",
];
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

export type AttachmentRouteCtx = {
  pool: PluginDb;
  requireAuth: MiddlewareHandler;
  requireWorkspace: MiddlewareHandler;
  requirePermission: (...codes: string[]) => MiddlewareHandler;
};

export function registerAttachmentRoutes(router: Hono, ctx: AttachmentRouteCtx): void {
  const { pool, requireAuth, requireWorkspace, requirePermission } = ctx;

  // ── Attachments (multipart file upload) ──────────────────────────────────
  router.get(
    "/:id/attachments",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c) => {
      const id = parseIntParam(c, "id");
      if (id == null) {
        return c.json({ error: "Invalid id" }, 400);
      }
      try {
        const rows = await pool.query(
          `SELECT a.id, a.transaction_id, a.file_name, a.file_size, a.mime_type, a.uploaded_by, a.s3_link, a.created_at
             FROM accounts.transaction_attachments a
             JOIN accounts.transactions t ON t.id = a.transaction_id
            WHERE a.transaction_id = $1 AND t.workspace_id = $2 ORDER BY a.created_at`,
          [id, ctxGet(c, "workspaceId")],
        );
        return c.json({ attachments: rows.rows });
      } catch (err) {
        console.error("[transactions] attachments list error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  // GET /:id/attachments/:attachmentId/raw — stream the private attachment's bytes
  // back through this authed route (the proxy/blob pattern). The object is NEVER
  // exposed at a public or signed third-party URL; the workspace+transaction JOIN
  // scoping IS the access gate (RLS is the second wall), re-checked on every fetch.
  // The UI renders the streamed bytes as a same-origin blob: — no DO origin, no
  // leakable bearer link.
  router.get(
    "/:id/attachments/:attachmentId/raw",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    async (c) => {
      const id = parseIntParam(c, "id");
      const attachmentId = parseIntParam(c, "attachmentId");
      if (id == null || attachmentId == null) {
        return c.json({ error: "Invalid id" }, 400);
      }
      try {
        const row = await pool.query<{ s3_link: string | null }>(
          `SELECT a.s3_link
             FROM accounts.transaction_attachments a
             JOIN accounts.transactions t ON t.id = a.transaction_id
            WHERE a.id = $1 AND a.transaction_id = $2 AND t.workspace_id = $3`,
          [attachmentId, id, ctxGet(c, "workspaceId")],
        );
        if (row.rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        const key = s3KeyFromUrl(row.rows[0].s3_link);
        if (!key) {
          return c.json({ error: "No object" }, 404);
        }
        const { body: s3Body, contentType } = await s3GetObject(key);
        return new Response(s3Body as any, {
          status: 200,
          headers: {
            "Content-Type": contentType || "application/octet-stream",
            "Cache-Control": `private, max-age=${ATTACHMENT_CACHE_SECONDS}`,
          },
        });
      } catch (err) {
        console.error("[transactions] attachment raw error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  router.post(
    "/:id/attachments",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      const id = parseIntParam(c, "id");
      if (id == null) {
        return c.json({ error: "Invalid id" }, 400);
      }
      const wsId = ctxGet(c, "workspaceId")!;
      if (!s3Enabled()) {
        return c.json({ error: "Attachment storage is not configured" }, 503);
      }
      // Parse multipart form data via Hono's built-in parser (replaces multer).
      const body = await c.req.parseBody();
      const file = body["file"];
      if (!(file instanceof File)) {
        return c.json({ error: "file is required (multipart/form-data)" }, 400);
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        return c.json({ error: "File too large (max 10MB)" }, 413);
      }
      if (!ALLOWED_ATTACHMENT_MIMES.includes(file.type)) {
        return c.json({ error: "File type not allowed" }, 400);
      }
      const file_name = (typeof body["file_name"] === "string" && body["file_name"]) || file.name;
      const filename = crypto.randomUUID() + path.extname(file.name).toLowerCase();
      const file_url = `transactions/${wsId}/${filename}`;
      const file_size = file.size;
      const mime_type = file.type || "application/octet-stream";
      try {
        const tx = await pool.query(
          `SELECT id FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
          [id, wsId],
        );
        if (tx.rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        // file_url is the generated object path; it builds the S3 key and the
        // public link. It is NOT stored — s3_link is the sole reference now.
        const key = `uploads/${file_url}`;
        // A1 retire: financial-document attachments upload PRIVATE — never
        // world-readable at a guessable URL. They are served only through the
        // ownership-scoped /raw stream route below. s3_link stays as the object
        // reference (key recovery for raw-serve/delete), not a public read path.
        // NOTE(A1 ops): attachment objects uploaded BEFORE this retire stay served
        // from the Spaces CDN until a CDN purge (`doctl compute cdn flush`) — the
        // ACL flip doesn't evict cached copies. New uploads (here) are private.
        const buffer = Buffer.from(await file.arrayBuffer());
        await s3PutObject(key, buffer, mime_type, {
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
              id,
              file_name,
              Number.isFinite(file_size) ? file_size : 0,
              mime_type || "application/octet-stream",
              ctxGet(c, "user")?.id ?? "",
              s3Link,
            ],
          );
        } catch (insertErr) {
          // Don't leave an unreferenced object behind when the row failed.
          await s3DeleteObject(key).catch(() => {});
          throw insertErr;
        }
        return c.json(result.rows[0], 201);
      } catch (err) {
        console.error("[transactions] attachment create error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );

  router.delete(
    "/:id/attachments/:attachmentId",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.edit"),
    async (c) => {
      const id = parseIntParam(c, "id");
      const attachmentId = parseIntParam(c, "attachmentId");
      if (id == null || attachmentId == null) {
        return c.json({ error: "Invalid id" }, 400);
      }
      try {
        const result = await pool.query(
          `DELETE FROM accounts.transaction_attachments a
             USING accounts.transactions t
            WHERE a.transaction_id = t.id
              AND a.id = $1 AND a.transaction_id = $2 AND t.workspace_id = $3
            RETURNING a.id, a.s3_link`,
          [attachmentId, id, ctxGet(c, "workspaceId")],
        );
        if (result.rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
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
        return c.body(null, 204);
      } catch (err) {
        console.error("[transactions] attachment delete error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    },
  );
}
