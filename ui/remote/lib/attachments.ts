// Attachment URL resolver for the plugin remote.
//
// POST /:id/attachments uploads the bytes; the server stores a path relative to
// UPLOAD_DIR ("transactions/<orgId>/<uuid>.<ext>"). We prefix the kernel's
// /assets/ mount (server/middleware/assets.ts) so it resolves — the path's
// first two segments are the plugin name + org id, both verified against the
// requester's memberships.
//
// Anything that already carries a URI scheme (http:, https:, and legacy junk
// like the old blob: object URLs that briefly got persisted) or an absolute
// path is returned as-is — NEVER prefixed. A `blob:` URL is dead after the
// session that minted it, but prefixing it ("/assets/blob:...") is strictly
// worse: it points at the kernel and 400s. New uploads never produce these.

export function attachmentUrl(filePath: string, s3Link?: string | null): string {
  // Prefer S3 link when available — but only if it's an http(s) URL. The value
  // flows straight into <a href> / <img src>, so a stored javascript:/data:/
  // vbscript: scheme would be stored XSS. Anything that doesn't pass the scheme
  // check falls through to the file_path handling below.
  if (s3Link && /^https?:/i.test(s3Link)) return s3Link;
  // Allowlist only the safe schemes (http(s), blob:) so javascript:/data:/
  // vbscript: can never pass through into an href — anything else relative
  // gets the /assets/ mount.
  if (/^(https?|blob):/i.test(filePath) || filePath.startsWith("/")) return filePath;
  return `/assets/${filePath}`;
}

// Whether a stored file_path can actually be fetched. Returns false for the dead
// `blob:` object URLs persisted by the old (pre-multipart) upload model — those
// only ever resolved in the browser session that minted them, so rendering them
// as a link/img just yields a broken request. Render sites show an "unavailable"
// placeholder for these instead. New uploads store a relative path and are fine.
export function isResolvableAttachment(
  filePath: string | null | undefined,
  s3Link?: string | null,
): boolean {
  // A valid S3 link is always fetchable, even when file_path is a dead blob: URL.
  if (s3Link && /^https?:/i.test(s3Link)) return true;
  if (!filePath) return false;
  return !/^blob:/i.test(filePath);
}
