/**
 * `throttle.ts` — sampling a continuous stream down to one call per interval.
 *
 * Why these tests matter:
 * The camera target goes into the URL while the camera moves (DEC-R13-7), and
 * the first implementation of this module was a DEBOUNCE that never fired once
 * in a real browser. `enableDamping` plus an on-demand renderer produce a
 * self-sustaining event loop — each `change` requests a frame, the frame updates
 * the controls, damping fires `change` again — measured at roughly one event per
 * 200 ms until it converged, so a 400 ms quiet period never arrived.
 *
 * The load-bearing test is therefore the one a debounce FAILS: a stream that
 * keeps arriving inside the window still gets written. The others pin what the
 * debounce did get right and must not be lost — trailing edge, latest arguments,
 * cancellation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { throttle } from "./throttle.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("throttle", () => {
  it("does not run before the interval has elapsed", () => {
    const run = vi.fn();
    throttle(run, 100)();
    vi.advanceTimersByTime(99);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  /**
   * THE ONE A DEBOUNCE FAILS, AND THE REASON THIS MODULE IS NOT ONE. Events keep
   * arriving faster than the interval — which is exactly what damped
   * `MapControls` produce against an on-demand renderer — so a deadline that
   * moves with each call never arrives. Here the deadline is fixed at the first
   * call, so the stream is SAMPLED rather than waited out.
   */
  it("still fires while events keep arriving inside the window", () => {
    const run = vi.fn();
    const throttled = throttle(run, 100);
    for (let tick = 0; tick < 10; tick += 1) {
      throttled(tick);
      vi.advanceTimersByTime(50);
    }
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("collapses a burst into ONE call, with the last arguments", () => {
    const run = vi.fn();
    const throttled = throttle(run, 100);
    throttled("a");
    throttled("b");
    throttled("c");
    vi.advanceTimersByTime(100);

    expect(run).toHaveBeenCalledTimes(1);
    // TRAILING, NOT LEADING: what matters is where the camera has got to, not
    // where it was when the pan started.
    expect(run).toHaveBeenCalledWith("c");
  });

  /**
   * AND THE LAST EVENT IS NEVER LOST. Sampling that dropped the final value
   * would leave the URL describing a viewpoint the user has since left, which is
   * the whole failure this feature exists to prevent.
   */
  it("always makes a final call after the stream stops", () => {
    const run = vi.fn();
    const throttled = throttle(run, 100);
    throttled("first");
    vi.advanceTimersByTime(100);
    throttled("last");
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith("last");
  });

  it("drops a pending call when cancelled", () => {
    const run = vi.fn();
    const throttled = throttle(run, 100);
    throttled();
    throttled.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it("is safe to cancel when nothing is pending, and works again afterwards", () => {
    const run = vi.fn();
    const throttled = throttle(run, 100);
    throttled.cancel();
    throttled.cancel();
    throttled("after");
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledWith("after");
  });

  /**
   * A bad interval must not silence the write. The failure mode of rejecting or
   * of an `Infinity` wait is a URL that never updates — silent, and
   * indistinguishable from the feature not being wired up — so running
   * immediately is the more useful wrong answer.
   */
  it("clamps a non-finite or negative interval rather than never firing", () => {
    for (const everyMs of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const run = vi.fn();
      throttle(run, everyMs)();
      vi.advanceTimersByTime(0);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });
});
