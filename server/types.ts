// Shared types for the transactions plugin.

export { isWorkspaceElevated } from "@kahitsan/plugin-sdk";

/** Type-safe accessor for Hono context variables set by the SDK middleware. */
export function ctxGet(c: any, key: string): any {
  return c.get(key);
}
