import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

/**
 * Value accessor with load state, the shape `createResource` gave callers.
 * Solid 2 async memos throw to a <Loading> boundary instead; consumers of these
 * hooks read `value()` unguarded, so loading stays a plain flag here.
 */
export interface FetchResource<T> extends Accessor<T | undefined> {
  readonly loading: boolean;
  readonly error: unknown;
}

/**
 * Fetch `fetcher(source())` whenever `source` changes to a truthy value.
 * A falsy source skips the fetch and keeps the last value; a refetch keeps the
 * previous value until the new one lands; a superseded response is dropped.
 */
export function createFetchResource<S, T>(
  source: () => S | false | null | undefined,
  fetcher: (source: S) => Promise<T>,
): FetchResource<T> {
  const [value, setValue] = createSignal<T | undefined>(undefined);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<unknown>(undefined);
  let token = 0;

  createEffect(source, (src) => {
    const mine = ++token;
    if (!src) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    fetcher(src).then(
      (next) => {
        if (mine !== token) return;
        setValue(() => next);
        setLoading(false);
      },
      (err: unknown) => {
        if (mine !== token) return;
        setError(err);
        setLoading(false);
      },
    );
  });
  onCleanup(() => {
    token++;
  });

  const read = (() => value()) as FetchResource<T>;
  Object.defineProperties(read, {
    loading: { get: loading },
    error: { get: error },
  });
  return read;
}
