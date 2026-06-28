// Shared types for the transactions plugin.

/** Type-safe accessor for Hono context variables set by the SDK middleware. */
export function ctxGet(c: any, key: string): any {
  return c.get(key);
}
