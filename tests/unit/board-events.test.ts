import { describe, expect, it } from "vitest";
import {
  boardVersion,
  bumpBoardVersion,
  subscribeBoard,
} from "../../server/lib/board-events.js";

// board-events is the in-process wake signal behind the Live Board SSE stream
// (Feature 23). The module state (versions map + subscriber sets) is
// module-global, so every test uses its OWN workspace id to stay isolated —
// never a shared constant. A monotonic counter works where Date.now() alone
// could collide within the same millisecond.

let wsCounter = 0;
const nextWs = (): number => (wsCounter += 1);

describe("boardVersion", () => {
  it("starts at 0 for a workspace with no recorded changes", () => {
    expect(boardVersion(nextWs())).toBe(0);
  });

  it("increments per workspace — workspaces are fully independent", () => {
    const a = nextWs();
    const b = nextWs();

    bumpBoardVersion(a);
    bumpBoardVersion(a);
    bumpBoardVersion(b);

    expect(boardVersion(a)).toBe(2);
    expect(boardVersion(b)).toBe(1);
  });
});

describe("bumpBoardVersion", () => {
  it("coalesces repeated bumps into a single version-number read", () => {
    const ws = nextWs();
    for (let i = 0; i < 5; i++) bumpBoardVersion(ws);
    expect(boardVersion(ws)).toBe(5);
  });
});

describe("subscribeBoard", () => {
  it("fires a subscriber synchronously on every bump, returning an unsubscribe", () => {
    const ws = nextWs();
    let calls = 0;
    const unsubscribe = subscribeBoard(ws, () => {
      calls += 1;
    });

    bumpBoardVersion(ws);
    bumpBoardVersion(ws);
    expect(calls).toBe(2);

    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("unsubscribing stops further firing", () => {
    const ws = nextWs();
    let calls = 0;
    const unsubscribe = subscribeBoard(ws, () => {
      calls += 1;
    });

    bumpBoardVersion(ws);
    expect(calls).toBe(1);

    unsubscribe();
    bumpBoardVersion(ws); // a bump while nothing is subscribed must not fire
    expect(calls).toBe(1);
  });

  it("tears down the emptied subscriber set, so a fresh subscribe still works", () => {
    // After the last subscriber of a workspace unsubscribes, subscribeBoard
    // drops the (now-empty) set. The observable contract the SSE fan-out leans
    // on is that the workspace can be subscribed again cleanly and wakes on the
    // next bump — which only holds if the emptied entry was released.
    const ws = nextWs();
    const fired: number[] = [];

    const unsub = subscribeBoard(ws, () => fired.push(1));
    unsub(); // set is now empty → registry entry deleted

    const fresh = subscribeBoard(ws, () => fired.push(2));
    bumpBoardVersion(ws);
    expect(fired).toEqual([2]); // only the fresh subscriber observed the bump

    fresh();
    // No subscriber left; a bump is still harmless and version keeps counting.
    bumpBoardVersion(ws);
    expect(boardVersion(ws)).toBe(2);
  });

  it("lets every subscriber on one workspace fire, and teardown is per-subscription", () => {
    const ws = nextWs();
    let a = 0;
    let b = 0;
    const unsubA = subscribeBoard(ws, () => {
      a += 1;
    });
    const unsubB = subscribeBoard(ws, () => {
      b += 1;
    });

    bumpBoardVersion(ws);
    expect(a).toBe(1);
    expect(b).toBe(1);

    unsubA();
    bumpBoardVersion(ws);
    expect(a).toBe(1); // A unsubscribed earlier
    expect(b).toBe(2);

    unsubB();
  });
});