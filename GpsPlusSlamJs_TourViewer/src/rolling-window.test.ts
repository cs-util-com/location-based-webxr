import { describe, expect, it } from "vitest";

import { createRollingWindow, ROLLING_WINDOW_MS } from "./rolling-window";

/**
 * Why these tests matter: the `?debug=1` readout's numbers - the ms per radar draw and the
 * frame time, each as the mean and the worst of the last 2 s - are what
 * the field check reads against the 50 ms frame budget. A window that kept
 * an old slow frame, or forgot a fresh one, would report a phone as worse
 * or better than it is; its property test compares the window with a naive
 * filter over every sample, at any rate and any gap.
 */

describe("createRollingWindow", () => {
  it("keeps 2 s by default", () => {
    expect(ROLLING_WINDOW_MS).toBe(2000);
  });

  it("has no summary before the first sample", () => {
    expect(createRollingWindow().summary(0)).toBeNull();
  });

  it("reports the mean and the worst of the samples inside the window", () => {
    const w = createRollingWindow();
    w.push(0, 10);
    w.push(500, 30);
    w.push(1000, 20);
    expect(w.summary(1000)).toEqual({ mean: 20, worst: 30, count: 3 });
  });

  it("forgets a sample once it is older than the window", () => {
    const w = createRollingWindow(1000);
    w.push(0, 90);
    w.push(600, 10);
    // At 1000 the first is exactly 1000 old: still inside.
    expect(w.summary(1000)?.worst).toBe(90);
    // A moment later it is gone, and the slow frame with it.
    expect(w.summary(1001)).toEqual({ mean: 10, worst: 10, count: 1 });
    expect(w.summary(1601)).toBeNull();
  });

  it("ignores a sample that is no finite number or is negative", () => {
    const w = createRollingWindow();
    w.push(0, Number.NaN);
    w.push(0, -1);
    w.push(Number.NaN, 5);
    w.push(0, Number.POSITIVE_INFINITY);
    expect(w.summary(0)).toBeNull();
  });

  it("holds at most its capacity, dropping the oldest", () => {
    const w = createRollingWindow(10_000, 3);
    for (let i = 0; i < 5; i += 1) w.push(i, i === 0 ? 100 : 1);
    expect(w.summary(5)).toEqual({ mean: 1, worst: 1, count: 3 });
  });

  it("starts over on reset", () => {
    const w = createRollingWindow();
    w.push(0, 5);
    w.reset();
    expect(w.summary(0)).toBeNull();
  });

  it("refuses a window or a capacity that is no positive number", () => {
    expect(() => createRollingWindow(0)).toThrow(RangeError);
    expect(() => createRollingWindow(1000, 0)).toThrow(RangeError);
    expect(() => createRollingWindow(1000, 2.5)).toThrow(RangeError);
  });
});
