// Source: KahitSan/kserp src/lib/account-logo-url.ts (vendored into the plugin remote).
// Build the <img src> for a financial account logo. The logo endpoint is
// gated by requireOrg, which reads the active org id from X-Organization-Id
// or a ?orgId= query-string fallback. A plain <img> can't set headers, so we
// pass orgId in the URL. `v` (the file path/UUID) is a cache-buster.

const LS_KEY = "ks_active_org_id";

export function activeOrgId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

export function buildLogoSrc(accountId: number, logoPath: string | null | undefined): string {
  const params = new URLSearchParams();
  params.set("v", logoPath ?? "");
  const orgId = activeOrgId();
  if (orgId) params.set("orgId", orgId);
  return `/api/financial-accounts/${accountId}/logo?${params.toString()}`;
}
