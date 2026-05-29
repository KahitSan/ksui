// Source: KahitSan/kserp src/lib/account-logo-url.ts (vendored into the plugin remote).
//
// Build the <img src> for a financial account logo. logoPath is the on-disk
// suffix stored in financial_accounts.logo_path, shaped
// "financial-accounts/<orgId>/<uuid>.webp". The kernel's /assets/ mount
// (server/middleware/assets.ts) is session-authed and org-membership-gated
// on the orgId segment in the path, so no query-string params are needed.

export function buildLogoSrc(logoPath: string | null | undefined): string {
  return `/assets/${logoPath ?? ""}`;
}
