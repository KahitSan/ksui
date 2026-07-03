// Shared types for the transactions plugin.

/** Type-safe accessor for Hono context variables set by the SDK middleware. */
export function ctxGet(c: any, key: string): any {
  return c.get(key);
}

/** Workspace admin or platform superuser — the shared bypass gate for privacy/backdate checks. */
export function isWorkspaceElevated(c: any): boolean {
  return ctxGet(c, "wsRole") === "admin" || ctxGet(c, "user")?.role === "superuser";
}
