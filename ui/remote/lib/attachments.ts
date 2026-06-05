// Attachment URL resolver for the plugin remote.
//
// Attachments are object-storage only: POST /:id/attachments uploads the bytes
// to S3 and stores the public URL in s3_link. That URL is the sole reference —
// the legacy on-disk file_path column and the kernel /assets/ fallback are gone.

export function attachmentUrl(s3Link: string | null | undefined): string {
  // The value flows straight into <a href> / <img src>, so only an http(s) URL
  // is allowed through — a stored javascript:/data:/vbscript: scheme would be
  // stored XSS. Every attachment has a valid https s3_link; anything else
  // yields an empty src and the render site shows an "unavailable" placeholder.
  if (s3Link && /^https?:/i.test(s3Link)) return s3Link;
  return "";
}

// Whether an attachment can actually be fetched — true only for a safe http(s)
// s3_link. Render sites show an "unavailable" placeholder otherwise.
export function isResolvableAttachment(s3Link: string | null | undefined): boolean {
  return !!s3Link && /^https?:/i.test(s3Link);
}
