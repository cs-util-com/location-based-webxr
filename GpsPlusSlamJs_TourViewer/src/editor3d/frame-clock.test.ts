/**
 * Why these tests matter: both 3D views time their frames for the
 * editor's Performance tab, and its badge counts the slow frames of the
 * last five seconds. A clock that kept every frame would grow without
 * bound; one that counted a slow frame forever would keep the badge up
 * after the view has recovered; and the mean must stay what the readout
 * has always shown (the last 60 intervals).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createFrameClock, SLOW_FRAME_MS } from "./frame-clock.js";

/** A clock that ticked at each of `times` (ms). */
function ticked(times: readonly number[], keep?: number) {
  const clock = createFrameClock(keep);
  for (const t of times) clock.tick(t);
  return clock;
}

describe("createFrameClock", () => {
  it("knows nothing before its second frame", () => {
    const clock = ticked([100]);
    expect(clock.meanMs()).toBe(0);
    expect(clock.worstMs()).toBe(0);
    expect(clock.slowFrames()).toBe(0);
    expect(clock.recentMs()).toEqual([]);
  });

  it("gives the mean and the worst of the intervals kept", () => {
    const clock = ticked([0, 16, 32, 92]);
    expect(clock.recentMs()).toEqual([16, 16, 60]);
    expect(clock.meanMs()).toBeCloseTo(92 / 3, 9);
    expect(clock.worstMs()).toBe(60);
    expect(clock.count()).toBe(3);
  });

  it("keeps only the last `keep` intervals", () => {
    const clock = ticked([0, 100, 110, 120], 2);
    expect(clock.recentMs()).toEqual([10, 10]);
    expect(clock.count()).toBe(3);
    expect(clock.worstMs()).toBe(10);
  });

  it("counts a frame over 50 ms as slow for five seconds after it", () => {
    const clock = ticked([0, 16, 16 + SLOW_FRAME_MS + 1, 100]);
    expect(clock.slowFrames()).toBe(1);
    clock.tick(4_000);
    // The 3.9 s gap is itself a slow frame (a hidden tab, say).
    expect(clock.slowFrames()).toBe(2);
    for (let t = 4_016; t < 5_100; t += 16) clock.tick(t);
    expect(clock.slowFrames()).toBe(1);
    for (let t = 5_100; t < 9_100; t += 16) clock.tick(t);
    expect(clock.slowFrames()).toBe(0);
  });

  it("does not count a frame of exactly 50 ms", () => {
    expect(ticked([0, SLOW_FRAME_MS]).slowFrames()).toBe(0);
  });

  // Why: whatever the frames, the kept window stays bounded and the mean
  // lies between the best and the worst kept interval.
  it("stays bounded with a mean inside its intervals (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.1, max: 500, noNaN: true }), {
          maxLength: 300,
        }),
        (gaps) => {
          let t = 0;
          const times = [0, ...gaps.map((g) => (t += g))];
          const clock = ticked(times);
          const kept = clock.recentMs();
          expect(kept.length).toBeLessThanOrEqual(60);
          const mean = clock.meanMs();
          const inside =
            kept.length === 0 ||
            (mean >= Math.min(...kept) - 1e-9 &&
              mean <= clock.worstMs() + 1e-9);
          expect(inside).toBe(true);
          expect(clock.slowFrames()).toBeLessThanOrEqual(gaps.length);
        },
      ),
    );
  });
});
