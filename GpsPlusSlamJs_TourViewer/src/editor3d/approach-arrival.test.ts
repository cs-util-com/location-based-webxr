/**
 * Why these tests matter: the owner chose the arrival of the quiet
 * prototype - stations that pop in one after another, then the recorded
 * walk drawing itself. These pin its order (the walk only after the last
 * station), its ends (every station at full size, nothing left mid-way)
 * and that reduced motion really shortens it.
 *
 * Parameters: the stagger, the pop length and the walk's gap. The order
 * check is swept over tours of 1, 3, 12 and 60 stations, and over the
 * stagger halved and doubled, so a long tour cannot start its walk before
 * its last station has begun to grow.
 */
import { describe, expect, it } from "vitest";

import {
  ARRIVAL,
  ARRIVAL_REDUCED,
  arrivalDone,
  stationPop,
  walkShare,
  walkStartMs,
} from "./approach-arrival.js";

describe("stationPop", () => {
  it("grows each station from nothing, with an overshoot, to full size", () => {
    // Why: the pop must start from nothing (no station visible before its
    // turn) and end exactly at full size.
    expect(stationPop(0, 0).scale).toBe(0);
    const peak = Math.max(
      ...Array.from(
        { length: 90 },
        (_, k) => stationPop(150 + k * 10, 0).scale,
      ),
    );
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.25);
    expect(stationPop(150 + ARRIVAL.popMs, 0).scale).toBe(1);
    expect(stationPop(Number.NaN, 4).scale).toBe(1);
  });

  it("staggers the stations in their order", () => {
    // Why: one after another is the prototype's look; all at once was
    // the rejected flat reveal.
    const t = ARRIVAL.delayMs + ARRIVAL.staggerMs * 0.5;
    expect(stationPop(t, 0).scale).toBeGreaterThan(0);
    expect(stationPop(t, 1).scale).toBe(0);
  });

  it("spreads one fading ring per station, then none", () => {
    // Why: the ring says where a station landed; one that stays would be
    // clutter on the ground.
    const start = ARRIVAL.delayMs + ARRIVAL.ringDelayMs;
    expect(stationPop(start - 1, 0).ring).toBeNull();
    const mid = stationPop(start + ARRIVAL.ringMs / 2, 0).ring;
    expect(mid).not.toBeNull();
    expect(mid!.opacity).toBeGreaterThan(0);
    expect(mid!.opacity).toBeLessThan(1);
    expect(stationPop(start + ARRIVAL.ringMs, 0).ring).toBeNull();
  });

  it("under reduced motion grows every station together, with no ring", () => {
    // Why: reduced motion must cut the movement, not only slow it.
    const t = ARRIVAL_REDUCED.popMs / 2;
    expect(stationPop(t, 0, ARRIVAL_REDUCED).scale).toBe(
      stationPop(t, 9, ARRIVAL_REDUCED).scale,
    );
    expect(stationPop(t, 0, ARRIVAL_REDUCED).ring).toBeNull();
    expect(arrivalDone(ARRIVAL_REDUCED.walkMs, 9, ARRIVAL_REDUCED)).toBe(true);
  });
});

describe("the walk", () => {
  it.each([1, 3, 12, 60])(
    "draws only after the last of %i stations has started to grow",
    (n) => {
      for (const factor of [0.5, 1, 2]) {
        const timing = { ...ARRIVAL, staggerMs: ARRIVAL.staggerMs * factor };
        const lastStart = timing.delayMs + (n - 1) * timing.staggerMs;
        expect(walkStartMs(n, timing)).toBeGreaterThan(lastStart);
        expect(walkShare(lastStart, n, timing)).toBe(0);
        const end = walkStartMs(n, timing) + timing.walkMs;
        expect(walkShare(end, n, timing)).toBe(1);
        expect(arrivalDone(end, n, timing)).toBe(true);
        expect(arrivalDone(end - 1, n, timing)).toBe(false);
      }
    },
  );

  it("only grows", () => {
    // Why: a line that draws back reads as a glitch.
    let last = 0;
    for (let t = 0; t <= 4000; t += 25) {
      const s = walkShare(t, 3);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });
});
