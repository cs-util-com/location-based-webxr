/**
 * The sky hand-over's arithmetic (globe F2 plan 2026-10-03-1922, F2b).
 *
 * Why this file matters: the descent from space to the ground swaps the
 * space pass's sky for the framework's ground sky. Every number the swap
 * rests on is here: the halo's thickness on the way down (DEC-GL5-13), the
 * cross-fade's weight below the edge, the observer's height in the steps
 * the ground sky is rebuilt at, and the exposure eased in its logarithm
 * (DEC-GL5-16). A kink or a jump in any of them is a visible pop in the
 * frame, so continuity and monotony are checked as properties.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GLOBE_SKY_HAND_OVER,
  easedExposure,
  groundSkyWeight,
  quantisedObserverKm,
  shellThicknessAt,
  sunStepped,
} from "./globe-sky-hand-over.js";

const altitudes = fc.double({ min: 0, max: 50_000, noNaN: true });

describe("shellThicknessAt", () => {
  // DEC-GL5-13: 6x far out, 1x on the descent, so the halo's thick shell
  // never meets a ground sky that refuses 100 km and above.
  it("is the far thickness above the ramp and 1 below it", () => {
    expect(shellThicknessAt(5_000, 6)).toBe(6);
    expect(shellThicknessAt(GLOBE_SKY_HAND_OVER.shellFromKm, 6)).toBe(6);
    expect(shellThicknessAt(GLOBE_SKY_HAND_OVER.shellToKm, 6)).toBe(1);
    expect(shellThicknessAt(150, 6)).toBe(1);
  });

  it("is halfway in log altitude at the ramp's geometric middle", () => {
    const { shellFromKm, shellToKm } = GLOBE_SKY_HAND_OVER;
    expect(shellThicknessAt(Math.sqrt(shellFromKm * shellToKm), 6)).toBeCloseTo(
      3.5,
      9,
    );
  });

  // A thickness of 1 (the slider's floor) has nothing to ramp.
  it("keeps a thickness of 1 at 1", () => {
    for (const km of [100, 500, 1_000, 3_000]) {
      expect(shellThicknessAt(km, 1)).toBe(1);
    }
  });

  it("falls monotonically with the descent, within [1, thickness]", () => {
    fc.assert(
      fc.property(altitudes, altitudes, (a, b) => {
        const [low, high] = a < b ? [a, b] : [b, a];
        const tLow = shellThicknessAt(low, 6);
        const tHigh = shellThicknessAt(high, 6);
        expect(tLow).toBeLessThanOrEqual(tHigh);
        expect(tLow).toBeGreaterThanOrEqual(1);
        expect(tHigh).toBeLessThanOrEqual(6);
      }),
    );
  });

  it("takes the ramp's edges as parameters, for the sweep", () => {
    expect(shellThicknessAt(1_000, 6, { fromKm: 1_000, toKm: 150 })).toBe(6);
    expect(shellThicknessAt(600, 6, { fromKm: 4_000, toKm: 600 })).toBe(1);
  });

  it.each([
    [Number.NaN, 6, {}],
    [100, 0.5, {}],
    [100, Number.NaN, {}],
    [100, 6, { fromKm: 300, toKm: 300 }],
    [100, 6, { fromKm: 300, toKm: 2_000 }],
    [100, 6, { fromKm: 2_000, toKm: 0 }],
  ])("refuses %s km, thickness %s, edges %o", (km, thickness, edges) => {
    expect(() => shellThicknessAt(km, thickness, edges)).toThrow(RangeError);
  });
});

describe("groundSkyWeight", () => {
  it("is 0 at and above the edge, 1 at and below the edge minus the width", () => {
    expect(groundSkyWeight(120, { edgeKm: 80, widthKm: 20 })).toBe(0);
    expect(groundSkyWeight(80, { edgeKm: 80, widthKm: 20 })).toBe(0);
    expect(groundSkyWeight(60, { edgeKm: 80, widthKm: 20 })).toBe(1);
    expect(groundSkyWeight(0.2, { edgeKm: 80, widthKm: 20 })).toBe(1);
    expect(groundSkyWeight(70, { edgeKm: 80, widthKm: 20 })).toBeCloseTo(
      0.5,
      12,
    );
  });

  // The defaults are the plan's: the edge at 80 km, 20 km wide.
  it("defaults to the plan's edge and width", () => {
    expect(groundSkyWeight(90)).toBe(0);
    expect(groundSkyWeight(55)).toBe(1);
  });

  // A weight that rises on the way down and never jumps: the ease's slope
  // is bounded by 1.5 / width, so a step of the altitude moves it by at
  // most 1.5 x the step over the width.
  it("rises with the descent and never jumps", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 200, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom(10, 20, 40),
        (km, step, widthKm) => {
          const opts = { edgeKm: 80, widthKm };
          const a = groundSkyWeight(km + step, opts);
          const b = groundSkyWeight(km, opts);
          expect(b).toBeGreaterThanOrEqual(a);
          expect(b - a).toBeLessThanOrEqual((1.5 * step) / widthKm + 1e-12);
        },
      ),
    );
  });

  it.each([
    [Number.NaN, {}],
    [50, { edgeKm: 100 }],
    [50, { edgeKm: 0 }],
    [50, { widthKm: 0 }],
    [50, { edgeKm: 30, widthKm: 40 }],
  ])("refuses %s km with %o", (km, opts) => {
    expect(() => groundSkyWeight(km, opts)).toThrow(RangeError);
  });
});

describe("quantisedObserverKm", () => {
  // The ground sky is rebuilt only when this value changes: log steps, so
  // a descent of 100 km to 1 km is ~94 rebuilds at 5 %, not one a frame.
  it("steps in log altitude and stays below the atmosphere's top", () => {
    expect(quantisedObserverKm(150)).toBe(
      GLOBE_SKY_HAND_OVER.observerCeilingKm,
    );
    expect(quantisedObserverKm(0)).toBe(0);
    expect(quantisedObserverKm(0.004)).toBe(0);
    // 0.01 km rounds to a 2 % step below the floor (0.0099 km): the
    // ground, so quantising again changes nothing (fast-check found it).
    expect(quantisedObserverKm(0.01, 2)).toBe(0);
    const q = quantisedObserverKm(37);
    expect(Math.abs(Math.log(q / 37))).toBeLessThanOrEqual(
      Math.log(1.05) / 2 + 1e-12,
    );
  });

  it("is idempotent and within half a step of the height", () => {
    fc.assert(
      fc.property(
        // From above the floor rounding zone (a height that rounds below
        // the floor is on the ground, its own test below).
        fc.double({ min: 0.012, max: 99, noNaN: true }),
        fc.constantFrom(2, 5, 10),
        (km, stepPct) => {
          const q = quantisedObserverKm(km, stepPct);
          expect(quantisedObserverKm(q, stepPct)).toBe(q);
          expect(Math.abs(Math.log(q / km))).toBeLessThanOrEqual(
            Math.log(1 + stepPct / 100) / 2 + 1e-9,
          );
        },
      ),
    );
  });

  // The count of rebuilds over a descent from 100 km to 1 km, the number
  // the plan's frame budget was sized with (about 48, 94 and 230).
  it.each([
    [10, 48],
    [5, 94],
    [2, 233],
  ])("changes about %s-percent-step times over 100 to 1 km", (stepPct, n) => {
    const seen = new Set<number>();
    for (let km = 100; km >= 1; km *= 0.999) {
      seen.add(quantisedObserverKm(km, stepPct));
    }
    expect(Math.abs(seen.size - n)).toBeLessThanOrEqual(2);
  });

  it.each([Number.NaN, -1])("refuses %s km", (km) => {
    expect(() => quantisedObserverKm(km)).toThrow(RangeError);
  });

  it("refuses a step that is not positive", () => {
    expect(() => quantisedObserverKm(10, 0)).toThrow(RangeError);
  });
});

describe("easedExposure", () => {
  // DEC-GL5-16: from the space view's fixed exposure to the ground sky's
  // automatic one, eased in the logarithm by the cross-fade's weight.
  it("is the space exposure at 0, the ground one at 1, the geometric mean at 0.5", () => {
    expect(easedExposure(5, 0.2, 0)).toBe(5);
    expect(easedExposure(5, 0.2, 1)).toBeCloseTo(0.2, 12);
    expect(easedExposure(5, 0.2, 0.5)).toBeCloseTo(1, 12);
  });

  // Equal steps of the weight are equal steps in EV: no jump anywhere.
  it("moves by equal EV steps for equal weight steps", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 0.9, noNaN: true }),
        (a, b, w) => {
          const ev = (x: number) => Math.log2(x);
          const d1 =
            ev(easedExposure(a, b, w + 0.1)) - ev(easedExposure(a, b, w));
          expect(Math.abs(d1 - 0.1 * (ev(b) - ev(a)))).toBeLessThan(1e-9);
        },
      ),
    );
  });

  it("clamps the weight into [0, 1]", () => {
    expect(easedExposure(5, 0.2, -1)).toBe(5);
    expect(easedExposure(5, 0.2, 2)).toBeCloseTo(0.2, 12);
  });

  it.each([
    [0, 1, 0.5],
    [1, -1, 0.5],
    [1, 1, Number.NaN],
    [Number.POSITIVE_INFINITY, 1, 0.5],
  ])("refuses %s, %s, %s", (a, b, w) => {
    expect(() => easedExposure(a, b, w)).toThrow(RangeError);
  });
});

describe("sunStepped", () => {
  // The ground sky's sun is rebuilt only when it has moved by a step (0.25
  // degrees by default): the clock moves it a little every frame.
  it("is true for a move of at least the step, false below it", () => {
    const deg = (d: number) => {
      const r = (d * Math.PI) / 180;
      return [Math.cos(r), Math.sin(r), 0] as const;
    };
    expect(sunStepped(deg(10), deg(10.2))).toBe(false);
    expect(sunStepped(deg(10), deg(10.3))).toBe(true);
    expect(sunStepped(deg(10), deg(10.2), 0.1)).toBe(true);
    expect(sunStepped(null, deg(10))).toBe(true);
  });

  it("refuses a non-finite direction or a step that is not positive", () => {
    expect(() => sunStepped([0, 1, 0], [Number.NaN, 1, 0])).toThrow(RangeError);
    expect(() => sunStepped([0, 1, 0], [0, 1, 0], 0)).toThrow(RangeError);
  });
});
