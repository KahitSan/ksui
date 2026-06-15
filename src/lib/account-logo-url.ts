// Source: KahitSan/kserp src/lib/account-logo-url.ts (vendored into the plugin remote).
//
// Build the <img src> for a financial account logo. Logos are object-storage
// only now: s3_link is the public URL and the sole reference (the legacy
// logo_path column + kernel /assets/ fallback are gone).

export function buildLogoSrc(s3Link: string | null | undefined): string {
  // The value flows straight into <img src>, so only an http(s) URL is allowed
  // through. A stored javascript:/data:/vbscript: scheme would be stored XSS.
  if (s3Link && /^https?:/i.test(s3Link)) return s3Link;
  return "";
}
