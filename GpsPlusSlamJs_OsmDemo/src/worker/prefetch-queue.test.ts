/**
 * The prefetch queue — where "throttled" has to be true rather than intended.
 *
 * Why these tests matter:
 * DEC-R2-6 accepted 170–400 MB per move against donated Overpass infrastructure
 * on the explicit condition that the throttling and the dropping actually work.
 * Every test here is one of those conditions, and each one fails in a way that
 * is invisible from the outside: a second concurrent request just makes things
 * slower, a prefetch that is not dropped just pulls a tile nobody looks at, and
 * a duplicate just doubles the bytes. None of them produces a wrong picture, so
 * none of them would ever be noticed without an assertion.
 *
 * @see prefetch-queue.ts.md
 */

import { describe, expect, it } from "vitest";

import { createPrefetchQueue } from "./prefetch-queue.js";

/** A fetch that never settles on its own, so a test controls the timing. */
function controllableFetch() {
  const calls: { tile: string; signal: AbortSignal; settle: () => void }[] = [];
  const fetchTile = (tile: string, signal: AbortSignal): Promise<unknown> =>
    new Promise<unknown>((resolve) => {
      calls.push({ tile, signal, settle: () => resolve(undefined) });
    });
  /** Settles the oldest unsettled call and lets the queue advance. */
  const settleFirst = async (): Promise<void> => {
    const call = calls.find((c) => !c.signal.aborted);
    call?.settle();
    // Two microtask turns: one for the `then`, one for the `finally` that starts
    // the next request.
    await Promise.resolve();
    await Promise.resolve();
  };
  return { calls, fetchTile, settleFirst };
}

describe("createPrefetchQueue", () => {
  it("fetches ONE tile at a time", () => {
    // The public Overpass instances allocate ~2 slots per client and the user's
    // own fetch needs one. A queue that opened three at once would take the
    // budget away from the thing the user is waiting for.
    const { calls, fetchTile } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });

    queue.replace(["a", "b", "c"]);

    expect(calls).toHaveLength(1);
    expect(queue.inFlight).toBe("a");
    expect(queue.pending).toBe(2);
  });

  it("starts the next one only when the previous settles", async () => {
    const { calls, fetchTile, settleFirst } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });

    queue.replace(["a", "b"]);
    await settleFirst();

    expect(calls.map((call) => call.tile)).toEqual(["a", "b"]);
  });

  it("ABORTS the in-flight tile when the user moves away from it", () => {
    // The half DEC-R2-6 singles out as having to genuinely work: a ~21 MB
    // request for ground the user has left is the exact waste the discipline
    // exists to avoid. Asserted on the SIGNAL, so it is the request that is
    // cancelled rather than merely the bookkeeping.
    const { calls, fetchTile } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });

    queue.replace(["a", "b"]);
    const first = calls[0];
    if (first === undefined) throw new Error("nothing was fetched");
    expect(first.signal.aborted).toBe(false);

    queue.replace(["x", "y"]);

    expect(first.signal.aborted).toBe(true);
  });

  it("keeps the in-flight tile when it is still wanted", () => {
    // The other direction, and the one that would quietly halve the value of the
    // feature: a walking user's next ring overlaps the last one by up to four
    // tiles, so restarting them all on every step would mean nothing ever
    // finishes.
    const { calls, fetchTile } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });

    queue.replace(["a", "b"]);
    const first = calls[0];
    if (first === undefined) throw new Error("nothing was fetched");

    queue.replace(["a", "c"]);

    expect(first.signal.aborted).toBe(false);
    expect(queue.inFlight).toBe("a");
  });

  it("does not queue the tile it is already fetching", () => {
    const { fetchTile } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });

    queue.replace(["a", "b"]);
    queue.replace(["a", "b"]);

    expect(queue.inFlight).toBe("a");
    expect(queue.pending).toBe(1);
  });

  it("de-duplicates a repeated tile in one request", () => {
    const { calls, fetchTile } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });

    queue.replace(["a", "a", "a"]);

    expect(calls).toHaveLength(1);
    expect(queue.pending).toBe(0);
  });

  it("skips tiles the index already holds", () => {
    // A prefetch of something already loaded is pure waste against a donated
    // service, and the ring of a position overlaps the ring of the last one by
    // up to four tiles.
    const { calls, fetchTile } = controllableFetch();
    const queue = createPrefetchQueue({
      fetchTile,
      isLoaded: (tile) => tile === "a",
    });

    queue.replace(["a", "b"]);

    expect(calls.map((call) => call.tile)).toEqual(["b"]);
  });

  it("bounds the queue, so a fast walk cannot grow it without limit", () => {
    const { fetchTile } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });

    queue.replace(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);

    expect(queue.pending).toBeLessThanOrEqual(6);
  });

  it("keeps going after a failure — a prefetch is never an error", async () => {
    // Nothing was promised to the user, and the next click will fetch it in the
    // foreground. Stopping the queue on a 429 would be the worst of both.
    const attempted: string[] = [];
    const queue = createPrefetchQueue({
      fetchTile: (tile) => {
        attempted.push(tile);
        return tile === "a"
          ? Promise.reject(new Error("429"))
          : Promise.resolve();
      },
    });

    queue.replace(["a", "b"]);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(attempted).toEqual(["a", "b"]);
  });

  it("stop() abandons everything, including the request in flight", () => {
    const { calls, fetchTile } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });

    queue.replace(["a", "b", "c"]);
    queue.stop();

    expect(calls[0]?.signal.aborted).toBe(true);
    expect(queue.pending).toBe(0);
  });
});

describe("retain() — freeing the slot BEFORE the user's own fetch", () => {
  /**
   * WHY THIS EXISTS. `replace` does two things: it drops what is no longer
   * wanted, and it starts fetching what is. The caller can only run it AFTER
   * the foreground fetch, because starting a background request before one
   * would be exactly the queue's stated sin. So the dropping half ran too late:
   * the previous position's prefetch kept holding one of the two slots for the
   * whole of the next click's fetch.
   *
   * That is not merely slow. `OverpassSlotBudget.tryAcquire` REFUSES rather
   * than queues, the refusal lands in `demo-pipeline.ts`'s per-tile catch, and
   * the tile becomes a `missingTiles` entry - geometry silently absent with no
   * error anywhere. Ring 2 needs two tiles on 18.5% of positions.
   *
   * `retain` is the dropping half on its own, safe to call before the fetch
   * because it starts nothing. A prefetch that is STILL wanted is kept, so a
   * user who barely moved does not lose a download that was nearly finished -
   * which is what a blanket `stop()` would have cost.
   */
  it("aborts an in-flight prefetch the new position no longer wants", () => {
    const { calls, fetchTile } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });
    queue.replace(["a", "b"]);
    expect(queue.inFlight).toBe("a");

    queue.retain(["x", "y"]);

    expect(calls[0]?.signal.aborted).toBe(true);
  });

  it("KEEPS an in-flight prefetch that is still wanted", () => {
    // The reason this is `retain` and not `stop`. A 21 MB prefetch takes
    // 15-90 s; discarding one the user still wants, on every click, would mean
    // it never completes under ordinary clicking.
    const { calls, fetchTile } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });
    queue.replace(["a", "b"]);

    queue.retain(["a", "z"]);

    expect(calls[0]?.signal.aborted).toBe(false);
    expect(queue.inFlight).toBe("a");
  });

  it("starts NOTHING, which is the whole reason it can run before the fetch", () => {
    // THE PROPERTY THAT MAKES IT SAFE. If `retain` started a request, calling it
    // before the foreground fetch would create precisely the contention it
    // exists to remove.
    const { calls, fetchTile } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });

    queue.retain(["a", "b", "c"]);

    expect(calls).toHaveLength(0);
    expect(queue.inFlight).toBeUndefined();
    expect(queue.pending).toBe(0);
  });

  it("drops queued tiles that are no longer wanted, without touching the rest", () => {
    const { calls, fetchTile } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });
    queue.replace(["a", "b", "c"]);
    expect(queue.pending).toBe(2);

    queue.retain(["a", "c"]);

    expect(queue.pending).toBe(1);
    expect(calls[0]?.signal.aborted).toBe(false);
  });

  it("does not restart the queue when the in-flight one is dropped", () => {
    // After aborting, the `finally` inside the queue calls `start()`. Anything
    // still queued would then go out - before the foreground fetch, which is
    // the one thing this must never do. Whatever survives waits for the next
    // `replace`.
    const { calls, fetchTile, settleFirst } = controllableFetch();
    const queue = createPrefetchQueue({ fetchTile });
    queue.replace(["a", "b", "c"]);

    queue.retain(["b", "c"]);

    return settleFirst().then(() => {
      // NO SECOND REQUEST, which is the claim. `inFlight` is deliberately not
      // asserted: this file's fake fetch never rejects on abort, so `active` is
      // only cleared when a call is settled, and `settleFirst` skips aborted
      // ones. The real `fetchTile` does reject, and the queue's `finally` then
      // clears `active` - at which point `start()` still sends nothing, because
      // that is what this asserts.
      expect(calls).toHaveLength(1);
    });
  });
});
