import { createResource, createEffect, onCleanup, type Resource } from "solid-js";

export interface ObjectUrlOptions {
  /** Extra fetch init, merged after `credentials: "include"` (e.g. tenant headers). */
  init?: RequestInit;
}

/**
 * Fetch a (typically authed, same-origin) resource and expose it as an object
 * URL (`blob:`) for an `<img src>` / `<a href>`. This is the proxy/blob pattern
 * for a privately-stored asset: the bytes come back through an app route that
 * enforces auth/ownership, never a public or signed third-party URL — so the
 * rendered src is a clean same-origin `blob:`, the storage origin is never
 * exposed, and there is no leakable bearer link.
 *
 * The href accessor is the resource source: when it changes, the new blob is
 * fetched and the previous object URL is revoked; the final one is revoked on
 * cleanup (a created object URL leaks until revoked). `url()` is null while
 * loading or on any failure — the consumer gates its own render — and
 * `url.loading` distinguishes the two.
 *
 * Domain-free: the consumer supplies the href and any init (headers/credentials);
 * this primitive assumes nothing about auth, tenancy, or endpoints.
 */
export function createObjectUrlResource(
  href: () => string | null | undefined,
  options: ObjectUrlOptions = {},
): Resource<string | null> {
  const [url] = createResource(
    () => href() || null,
    async (src) => {
      const res = await fetch(src, { credentials: "include", ...options.init });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
  );

  // Revoke the previous object URL when the resolved value changes, and the
  // final one on unmount. During a refetch the resource holds its prior value
  // (cur === prev), so an in-flight reload doesn't revoke a URL still on screen.
  let prev: string | null = null;
  createEffect(() => {
    const cur = url() ?? null;
    if (prev && prev !== cur) URL.revokeObjectURL(prev);
    prev = cur;
  });
  onCleanup(() => {
    if (prev) URL.revokeObjectURL(prev);
  });

  return url;
}
