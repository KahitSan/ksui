// Workspace-scoped change signal for counter-board data (transactions, line
// items, payments). Every successful mutating request in this plugin bumps the
// workspace's version; SSE subscribers wake instantly and the capacity-usage
// cache keys on it. In-process state is sufficient: the plugin runs as ONE
// pm2 process, so a module-level registry observes every write this plugin
// can make. Time-driven changes (a session's ends_at passing NOW()) do NOT
// bump — consumers pair the signal with a short TTL / poll for those.

type Subscriber = () => void;

const versions = new Map<number, number>();
const subscribers = new Map<number, Set<Subscriber>>();

export function boardVersion(wsId: number): number {
  return versions.get(wsId) ?? 0;
}

export function bumpBoardVersion(wsId: number): void {
  versions.set(wsId, (versions.get(wsId) ?? 0) + 1);
  for (const fn of subscribers.get(wsId) ?? []) fn();
}

/** Register a wake callback for a workspace's board changes; returns the
 * unsubscribe. Callbacks must not throw (fired synchronously on write paths). */
export function subscribeBoard(wsId: number, fn: Subscriber): () => void {
  let set = subscribers.get(wsId);
  if (!set) {
    set = new Set();
    subscribers.set(wsId, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) subscribers.delete(wsId);
  };
}
