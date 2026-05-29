// Attachment URL resolver for the plugin remote.
//
// Unlike the monolith (which stored uploaded bytes on a disk path served at
// /uploads/<path> via getApiBaseUrl()), the isolated transactions plugin is
// URL-based: POST /:id/attachments takes { file_name, file_url, ... } and
// stores the URL in file_path. So the attachment's href IS file_path. When a
// legacy/relative path sneaks through we prefix the kernel's /assets/ mount
// (server/middleware/assets.ts) so historical rows render. The path's first
// two segments are the plugin name + org id, both of which the kernel verifies
// against the requester's memberships.

export function attachmentUrl(filePath: string): string {
  if (/^https?:\/\//i.test(filePath) || filePath.startsWith("/")) return filePath;
  return `/assets/${filePath}`;
}
