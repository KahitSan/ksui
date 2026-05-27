// Attachment URL resolver for the plugin remote.
//
// Unlike the monolith (which stored uploaded bytes on a disk path served at
// /uploads/<path> via getApiBaseUrl()), the isolated transactions plugin is
// URL-based: POST /:id/attachments takes { file_name, file_url, ... } and
// stores the URL in file_path. So the attachment's href IS file_path. When a
// legacy/relative path sneaks through we still prefix /uploads/ as a fallback
// so historical rows render.

export function attachmentUrl(filePath: string): string {
  if (/^https?:\/\//i.test(filePath) || filePath.startsWith("/")) return filePath;
  return `/uploads/${filePath}`;
}
