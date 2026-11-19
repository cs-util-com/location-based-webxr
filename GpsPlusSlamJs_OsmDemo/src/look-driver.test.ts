/**
 * The look driver: the weights the sun's elevation shows.
 *
 * WHY THESE TESTS MATTER. The driver is the only place the sun becomes a
 * look; a wrong point or a jump at the morning/evening flip shows as the
 * whole city changing colour in one frame. The shipped points are pinned
 * at their edges, the properties (sum 1, range, continuity) are checked for
 * every elevation, and the rule is swept: every point moved by 2 degrees
 * either way and every blend width halved and doubled, so the verdict "the
 * flip is continuous to about 60 degrees of latitude" is shown across that
 * range, not at one set of numbers.
 */

import fc from "fast-check";
import {
  solarDateAt,
  solarMidnight,
  solarNoon,
  solarPosition,
} from "gps-plus-slam-app-framework/geo/solar-position";
import { describe, expect, it } from "vitest";

import {
  agreementBounds,
  isMorningAt,
  LOOK_KEYFRAMES,
  lookWeightsAt,
  validateKeyframes,
  type LookKeyframe,
  type LookKeyframes,
} from "./look-driver.js";
import { TIME_OF_DAY_LOOKS } from "./look-choice.js";

const DAY = [1, 0, 0, 0];
const GOLDEN = [0, 1, 0, 0];
const DUSK = [0, 0, 1, 0];
const BLUE = [0, 0, 0, 1];

function expectWeights(actual: readonly number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((w, k) => expect(w).toBeCloseTo(expected[k] ?? NaN, 12));
}

/** The steepest slope (weight per degree) a limb can have. */
function maxSlope(points: readonly LookKeyframe[]): number {
  let slope = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const span = points[i]!.elevationDeg - points[i + 1]!.elevationDeg;
    if (points[i]!.look !== points[i + 1]!.look && span > 0) {
      slope = Math.max(slope, 1 / span);
    }
  }
  return slope;
}

describe("lookWeightsAt - the shipped points", () => {
  it.each([
    [30, false, DAY],
    [9, false, DAY],
    [7.5, false, [0.5, 0.5, 0, 0]],
    [6, false, GOLDEN],
    [2, false, GOLDEN],
    [1, false, [0, 0.5, 0.5, 0]],
    [0, false, DUSK],
    [-2, false, DUSK],
    [-2.75, false, [0, 0, 0.5, 0.5]],
    [-3.5, false, BLUE],
    [-40, false, BLUE],
    [9, true, DAY],
    [4, true, GOLDEN],
    [2, true, GOLDEN],
    [-0.75, true, [0, 0.5, 0, 0.5]],
    [-3.5, true, BLUE],
  ] as const)("at %s degrees, morning %s", (elevation, morning, expected) => {
    const weights = lookWeightsAt(elevation, morning);
    expect(weights).toHaveLength(TIME_OF_DAY_LOOKS.length);
    expectWeights(weights, [...expected]);
  });

  it("returns a frozen list, one weight per look", () => {
    const w = lookWeightsAt(1, false);
    expect(w).toHaveLength(TIME_OF_DAY_LOOKS.length);
    expect(Object.isFrozen(w)).toBe(true);
  });

  // WHY: a NaN elevation (a sun read before the place is known) must not
  // become a NaN weight that reaches a uniform.
  it("refuses an elevation that is not finite", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => lookWeightsAt(bad, false)).toThrow(RangeError);
    }
  });
});

describe("validateKeyframes", () => {
  it("accepts the shipped points", () => {
    expect(() => validateKeyframes(LOOK_KEYFRAMES.evening)).not.toThrow();
    expect(() => validateKeyframes(LOOK_KEYFRAMES.morning)).not.toThrow();
  });

  it.each([
    ["no point", []],
    ["a NaN elevation", [{ elevationDeg: NaN, look: 0 }]],
    ["a look out of range", [{ elevationDeg: 1, look: 4 }]],
    ["a fractional look", [{ elevationDeg: 1, look: 0.5 }]],
    [
      "a rising elevation",
      [
        { elevationDeg: 1, look: 0 },
        { elevationDeg: 2, look: 1 },
      ],
    ],
  ])("refuses %s", (_, points) => {
    expect(() => validateKeyframes(points)).toThrow(RangeError);
  });
});

/**
 * The swept rule: each point moved by -2, 0 or +2 degrees, one at a time,
 * and every blend width (a span between two different looks) scaled by 0.5
 * or 2 about its upper point. Variants whose points no longer run from high
 * to low, or that turn a blend into a hard step (two different looks at one
 * elevation), are dropped: they are not rules anyone could ship.
 */
function sweptKeyframes(): { name: string; frames: LookKeyframes }[] {
  const out: { name: string; frames: LookKeyframes }[] = [
    { name: "shipped", frames: LOOK_KEYFRAMES },
  ];
  const limbs = ["evening", "morning"] as const;
  const valid = (points: LookKeyframe[]) => {
    try {
      validateKeyframes(points);
    } catch {
      return false;
    }
    return points.every((p, j) => {
      const next = points[j + 1];
      return (
        next === undefined ||
        next.look === p.look ||
        next.elevationDeg < p.elevationDeg
      );
    });
  };
  for (const limb of limbs) {
    const points = LOOK_KEYFRAMES[limb];
    points.forEach((_, i) => {
      for (const shift of [-2, 2]) {
        const moved = points.map((p, j) =>
          j === i ? { ...p, elevationDeg: p.elevationDeg + shift } : p,
        );
        if (valid(moved)) {
          out.push({
            name: `${limb} point ${i} ${shift > 0 ? "+" : ""}${shift}`,
            frames: { ...LOOK_KEYFRAMES, [limb]: moved },
          });
        }
      }
    });
    for (const scale of [0.5, 2]) {
      for (let i = 0; i + 1 < points.length; i++) {
        const high = points[i]!;
        const low = points[i + 1]!;
        if (high.look === low.look) continue;
        const shift = (high.elevationDeg - low.elevationDeg) * (scale - 1);
        const scaled = points.map((p, j) =>
          j > i ? { ...p, elevationDeg: p.elevationDeg - shift } : p,
        );
        if (valid(scaled)) {
          out.push({
            name: `${limb} blend ${i} x${scale}`,
            frames: { ...LOOK_KEYFRAMES, [limb]: scaled },
          });
        }
      }
    }
  }
  return out;
}

const SWEEP = sweptKeyframes();

describe("lookWeightsAt - properties, across the swept rule", () => {
  it("sweeps a real range of variants", () => {
    expect(SWEEP.length).toBeGreaterThan(20);
  });

  // WHY: the weights feed a mix that assumes a partition of one; a sum off
  // 1 brightens or darkens the city, a negative weight inverts a colour.
  it.each(SWEEP)(
    "$name: weights sum to 1, each in [0, 1], two at most",
    ({ frames }) => {
      fc.assert(
        fc.property(
          fc.double({ min: -90, max: 90, noNaN: true }),
          fc.boolean(),
          (elevation, morning) => {
            const w = lookWeightsAt(elevation, morning, frames);
            expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
            for (const x of w) {
              expect(x).toBeGreaterThanOrEqual(0);
              expect(x).toBeLessThanOrEqual(1);
            }
            expect(w.filter((x) => x > 0).length).toBeLessThanOrEqual(2);
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // WHY: the sun moves continuously, so the look must; a jump would be the
  // whole city changing colour in one frame. The bound is the steepest
  // blend's slope, so a hard step (zero width) is the one thing excluded.
  it.each(SWEEP)(
    "$name: each limb is continuous in the elevation",
    ({ frames }) => {
      fc.assert(
        fc.property(
          fc.double({ min: -20, max: 20, noNaN: true }),
          fc.double({ min: 0, max: 0.5, noNaN: true }),
          fc.boolean(),
          (elevation, step, morning) => {
            const points = morning ? frames.morning : frames.evening;
            const a = lookWeightsAt(elevation, morning, frames);
            const b = lookWeightsAt(elevation - step, morning, frames);
            const bound = maxSlope(points) * step + 1e-9;
            a.forEach((w, k) =>
              expect(Math.abs(w - (b[k] ?? 0))).toBeLessThanOrEqual(bound),
            );
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // WHY: dusk is the evening after the day's light; a morning that showed
  // it would be a sunrise that looks like a sunset.
  it("the morning never shows dusk", () => {
    fc.assert(
      fc.property(fc.double({ min: -90, max: 90, noNaN: true }), (e) => {
        expect(lookWeightsAt(e, true)[TIME_OF_DAY_LOOKS.indexOf("dusk")]).toBe(
          0,
        );
      }),
    );
  });
});

describe("agreementBounds and the flip", () => {
  it("the shipped limbs agree above 2 degrees and below -3.5", () => {
    expect(agreementBounds()).toEqual({ above: 2, below: -3.5 });
    for (const e of [2, 2.01, 30, -3.5, -3.51, -40]) {
      expectWeights(lookWeightsAt(e, true), [...lookWeightsAt(e, false)]);
    }
    expect(lookWeightsAt(1.99, true)).not.toEqual(lookWeightsAt(1.99, false));
    expect(lookWeightsAt(-3.49, true)).not.toEqual(lookWeightsAt(-3.49, false));
  });

  it("two equal limbs agree everywhere", () => {
    const same = {
      evening: LOOK_KEYFRAMES.evening,
      morning: LOOK_KEYFRAMES.evening,
    };
    expect(agreementBounds(same)).toEqual({
      above: -Infinity,
      below: Infinity,
    });
  });

  /**
   * The latitude up to which the flip is continuous all year: the noon sun
   * must stay at or above `above` in winter (90 - lat - 23.44) and the
   * midnight sun at or below `below` in summer (lat + 23.44 - 90).
   */
  function flipLatitudeLimit(frames: LookKeyframes): number {
    const { above, below } = agreementBounds(frames);
    return 90 - 23.44 + Math.min(-above, below);
  }

  // WHY: the claim "continuous to about 60 degrees" rests on the points.
  // With the shipped ones the edge is 63.06 degrees; across the swept rule
  // it moves between 55.56 (the evening's day point raised to 11 degrees
  // alone, so the limbs disagree up to 11) and 63.06: no single move raises
  // it, since each limb's own blue-hour point holds it. The lowest edges all
  // come from moving one limb's point without the other's; moving the
  // shared points together keeps the edge where the blue-hour point puts it.
  it("the flip latitude edge across the swept rule", () => {
    const limits = SWEEP.map(({ frames }) => flipLatitudeLimit(frames));
    expect(flipLatitudeLimit(LOOK_KEYFRAMES)).toBeCloseTo(63.06, 2);
    expect(Math.min(...limits)).toBeCloseTo(55.56, 2);
    expect(Math.max(...limits)).toBeCloseTo(63.06, 2);
    const shared = (shift: number) => ({
      evening: LOOK_KEYFRAMES.evening.map((p, i) =>
        i === 0 ? { ...p, elevationDeg: p.elevationDeg + shift } : p,
      ),
      morning: LOOK_KEYFRAMES.morning.map((p, i) =>
        i === 0 ? { ...p, elevationDeg: p.elevationDeg + shift } : p,
      ),
    });
    expect(flipLatitudeLimit(shared(2))).toBeCloseTo(63.06, 2);
    expect(flipLatitudeLimit(shared(-2))).toBeCloseTo(63.06, 2);
  });

  // WHY: the derivation above is geometry; this runs the real solar model
  // at 60 degrees north (and south) through a year of noons and midnights,
  // across the flip, and checks the weights do not jump.
  it("the real sun at 60 degrees flips without a jump, every day of a year", () => {
    const start = Date.UTC(2026, 0, 1, 12);
    for (const lat of [60, -60]) {
      for (let day = 0; day < 366; day += 3) {
        const date = solarDateAt(start + day * 86_400_000, 0);
        for (const atNoon of [true, false]) {
          const flip = atNoon ? solarNoon(date, 0) : solarMidnight(date, 0);
          const before = flip - 60_000;
          const after = flip + 60_000;
          expect(isMorningAt(before, 0)).toBe(atNoon);
          expect(isMorningAt(after, 0)).toBe(!atNoon);
          const weights = (ms: number) =>
            lookWeightsAt(
              (solarPosition(ms, lat, 0).elevationRad * 180) / Math.PI,
              isMorningAt(ms, 0),
            );
          const a = weights(before);
          const b = weights(after);
          a.forEach((w, k) =>
            expect(Math.abs(w - (b[k] ?? 0))).toBeLessThan(0.02),
          );
        }
      }
    }
  });
});

describe("isMorningAt", () => {
  // WHY: the limb is solar time at the place, not the clock: noon in
  // Cologne and in Tokyo are different instants.
  it("follows apparent solar time at the longitude", () => {
    const utcNoon = Date.UTC(2026, 5, 21, 12);
    expect(isMorningAt(utcNoon - 3_600_000, 0)).toBe(true);
    expect(isMorningAt(utcNoon + 3_600_000, 0)).toBe(false);
    expect(isMorningAt(utcNoon, 139.7)).toBe(false);
    expect(isMorningAt(utcNoon, -74)).toBe(true);
  });
});
