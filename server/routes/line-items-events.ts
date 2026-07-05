// GET /api/transaction-line-items/events — the board change stream.
//
// One SSE connection per counter tab. `board-changed` fires on any write in
// this plugin for the workspace (the write-bump middleware in
// routes-line-items.ts); heartbeats keep the connection alive through nginx.
// Time-driven decay (a session expiring by wall clock) never fires an event —
// the UI keeps a slow poll for that.

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { boardVersion, subscribeBoard } from "../lib/board-events.js";
import type { RouterDeps } from "../routes.js";
import { ctxGet } from "../types.js";

export function registerLineItemEventsRoute(router: Hono, deps: RouterDeps): void {
  const { requireAuth, requireWorkspace, requirePermission } = deps;

  router.get(
    "/api/transaction-line-items/events",
    requireAuth,
    requireWorkspace,
    requirePermission("transactions.view"),
    (c) => {
      const wsId = ctxGet(c, "workspaceId");
      if (!wsId) {
        return c.json({ error: "No workspace context" }, 403);
      }
      // nginx must not buffer an event-stream (streamSSE sets Content-Type +
      // Cache-Control itself); without this the client sees no frames until close.
      c.header("X-Accel-Buffering", "no");
      return streamSSE(c, async (stream) => {
        let aborted = false;
        let wake: (() => void) | null = null;
        stream.onAbort(() => {
          aborted = true;
          wake?.();
        });
        const unsubscribe = subscribeBoard(wsId, () => wake?.());
        try {
          await stream.writeSSE({ event: "hello", data: String(boardVersion(wsId)) });
          while (!aborted) {
            const before = boardVersion(wsId);
            await new Promise<void>((resolve) => {
              wake = resolve;
              // Heartbeat cadence: under nginx's default 60s proxy timeout.
              setTimeout(resolve, 25_000);
            });
            wake = null;
            if (aborted) break;
            const v = boardVersion(wsId);
            // Bumps between the two reads coalesce into one event.
            await stream.writeSSE({
              event: v !== before ? "board-changed" : "heartbeat",
              data: String(v),
            });
          }
        } finally {
          unsubscribe();
        }
      });
    },
  );
}
