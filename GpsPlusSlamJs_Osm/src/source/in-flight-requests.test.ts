/**
 * De-duplication tests.
 *
 * Why these tests matter:
 * De-duplicating concurrent requests for the same key is the cheapest network
 * saving in the package, and the naive version — a `Map<key, Promise>` keyed on
 * the key alone — quietly makes the FIRST caller's `AbortSignal` govern every
 * later one. Two callers are documented as racing here (a movement trigger and
 * an explicit prefetch) and they have different lifetimes, so that is not a
 * theoretical concern: cancelling a prefetch would fail an unrelated working-set
 * load, and a joiner cancelling its own request would cancel nothing at all.
 *
 * Both directions are asserted below, because a fix for one is easy to write in
 * a way that breaks the other.
 *
 * @see in-flight-requests.ts.md
 */

import { describe, it, expect, vi } from "vitest";
import { InFlightRequests } from "./in-flight-requests.js";

/** A dispatch whose completion the test controls, exposing the signal it got. */
function deferredDispatch() {
  let resolve!: (value: string) => void;
  let reject!: (reason: unknown) => void;
  const signals: AbortSignal[] = [];
  const dispatch = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  // Both wrapped in arrows: the bindings are only assigned once the executor
  // runs, so capturing them by value here would capture `undefined`.
  return {
    dispatch,
    signals,
    resolve: (v: string) => resolve(v),
    reject: (reason: unknown) => reject(reason),
  };
}

describe("joining an in-flight request", () => {
  it("dispatches once and hands the result to every caller", async () => {
    const { dispatch, resolve } = deferredDispatch();
    const requests = new InFlightRequests<string>();

    const a = requests.join("tile", dispatch, new AbortController().signal);
    const b = requests.join("tile", dispatch, new AbortController().signal);
    resolve("payload");

    expect(await a).toBe("payload");
    expect(await b).toBe("payload");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("releases the key once settled, so a later caller dispatches again", async () => {
    const first = deferredDispatch();
    const requests = new InFlightRequests<string>();
    const a = requests.join("tile", first.dispatch);
    first.resolve("one");
    await a;

    const second = deferredDispatch();
    const b = requests.join("tile", second.dispatch);
    second.resolve("two");

    expect(await b).toBe("two");
    expect(second.dispatch).toHaveBeenCalledTimes(1);
  });

  it("releases the key after a FAILURE too", async () => {
    const first = deferredDispatch();
    const requests = new InFlightRequests<string>();
    const a = requests.join("tile", first.dispatch);
    first.reject(new Error("upstream down"));
    await expect(a).rejects.toThrow(/upstream down/);

    const second = deferredDispatch();
    const b = requests.join("tile", second.dispatch);
    second.resolve("two");
    expect(await b).toBe("two");
  });
});

describe("one caller's abort must not reach another's", () => {
  it("rejects only the caller that aborted, and keeps the request running", async () => {
    // The failure this prevents: a prefetch and a movement trigger share a
    // tile, the user cancels the prefetch, and the movement trigger's entire
    // working-set load fails with an AbortError for a signal it never owned.
    const { dispatch, signals, resolve } = deferredDispatch();
    const requests = new InFlightRequests<string>();
    const prefetch = new AbortController();
    const movement = new AbortController();

    const a = requests.join("tile", dispatch, prefetch.signal);
    const b = requests.join("tile", dispatch, movement.signal);

    prefetch.abort();

    await expect(a).rejects.toThrow();
    expect(signals[0]?.aborted).toBe(false); // still in flight for the joiner
    resolve("payload");
    expect(await b).toBe("payload");
  });

  it("aborts the underlying request only once every caller has gone", async () => {
    // The mirror property. Keeping the request alive for a departed caller
    // would be a leak, and the whole point of accepting a signal is that it
    // eventually cancels real work.
    const { dispatch, signals } = deferredDispatch();
    const requests = new InFlightRequests<string>();
    const first = new AbortController();
    const second = new AbortController();

    const a = requests.join("tile", dispatch, first.signal);
    const b = requests.join("tile", dispatch, second.signal);

    first.abort();
    expect(signals[0]?.aborted).toBe(false);
    second.abort();
    expect(signals[0]?.aborted).toBe(true);

    await expect(a).rejects.toThrow();
    await expect(b).rejects.toThrow();
  });

  it("never cancels a request a caller without a signal is waiting on", async () => {
    // No signal means "I cannot be cancelled". Counting such a caller as
    // departed would let an unrelated abort pull the result out from under it.
    const { dispatch, signals, resolve } = deferredDispatch();
    const requests = new InFlightRequests<string>();
    const cancellable = new AbortController();

    const pinned = requests.join("tile", dispatch);
    const other = requests.join("tile", dispatch, cancellable.signal);

    cancellable.abort();
    await expect(other).rejects.toThrow();
    expect(signals[0]?.aborted).toBe(false);

    resolve("payload");
    expect(await pinned).toBe("payload");
  });

  it("rejects an already-aborted caller without dispatching anything", async () => {
    const { dispatch } = deferredDispatch();
    const requests = new InFlightRequests<string>();
    const controller = new AbortController();
    controller.abort();

    await expect(
      requests.join("tile", dispatch, controller.signal),
    ).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not join an already-aborted caller onto a live request", async () => {
    const { dispatch, signals, resolve } = deferredDispatch();
    const requests = new InFlightRequests<string>();
    const live = new AbortController();
    const dead = new AbortController();
    dead.abort();

    const a = requests.join("tile", dispatch, live.signal);
    await expect(
      requests.join("tile", dispatch, dead.signal),
    ).rejects.toThrow();

    // The dead caller must not have been counted as a waiter, and must not
    // have decremented the live one's claim on the request either.
    expect(signals[0]?.aborted).toBe(false);
    resolve("payload");
    expect(await a).toBe("payload");
  });
});

describe("bookkeeping", () => {
  it("reports whether a key is already in flight, for dedup stats", async () => {
    const { dispatch, resolve } = deferredDispatch();
    const requests = new InFlightRequests<string>();

    expect(requests.has("tile")).toBe(false);
    const a = requests.join("tile", dispatch);
    expect(requests.has("tile")).toBe(true);

    resolve("payload");
    await a;
    expect(requests.has("tile")).toBe(false);
  });
});
