// Identity middleware for the standalone plugin process.
//
// In the process-isolation model the plugin does NOT authenticate — it has no
// session secret. The kernel resolves the principal at the reverse proxy and
// forwards it in a signed header (kernel/plugin-ipc). `parseIdentity` verifies
// that header and populates req.user; `requireAuth` is the plugin's gate that
// rejects requests the kernel didn't vouch for. A forged header fails the HMAC
// check in verifyIdentity and is ignored, so req.user stays unset.

import type { Request, Response, NextFunction } from "express";
import { IDENTITY_HEADER, verifyIdentity } from "@ks-erp/kernel/plugin-ipc";

const secret = () => process.env.KSERP_INTERNAL_SECRET || "";

/** Populate req.user/authMethod/org/permissions from the kernel-signed identity header. */
export function parseIdentity(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers[IDENTITY_HEADER];
  const id = verifyIdentity(typeof header === "string" ? header : undefined, secret());
  if (id) {
    req.user = id.user;
    req.authMethod = id.authMethod;
    if (id.organizationId !== undefined) req.organizationId = id.organizationId;
    if (id.orgRole !== undefined) req.orgRole = id.orgRole;
    if (id.permissions !== undefined) req.permissions = id.permissions;
  }
  next();
}

/** Require the kernel to have forwarded an authenticated identity. After parseIdentity. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

/**
 * Require org context. The kernel resolves the active org (validated against
 * the user's memberships) and forwards `organizationId`/`orgRole` in the signed
 * identity — so the plugin NEVER reads the kernel's tenant tables. Use
 * `req.organizationId` to scope every query. After requireAuth.
 */
export function requireOrg(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (req.organizationId == null) {
    res.status(400).json({ error: "Organization context required (X-Organization-Id)" });
    return;
  }
  next();
}

/**
 * Require a permission the kernel resolved for the active org. Superusers and
 * org admins are all-access. The permission set is forwarded by the kernel, so
 * custom RBAC grants Just Work without the plugin reading role_permissions.
 */
export function requirePermission(...codes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.role === "superuser" || req.orgRole === "admin") return next();
    const held = req.permissions ?? [];
    if (codes.some((c) => held.includes(c))) return next();
    res.status(403).json({ error: "Insufficient permissions" });
  };
}
