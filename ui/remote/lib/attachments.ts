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

export function attachmentUrl(filePath: string): string {
  // Allowlist only the safe schemes (http(s), blob:) so javascript:/data:/
  // vbscript: can never pass through into an href — anything else relative
  // gets the /assets/ mount.
  if (/^(https?|blob):/i.test(filePath) || filePath.startsWith("/")) return filePath;
  return `/assets/${filePath}`;
}
