/**
 * Why these properties matter: the editor drags items to wherever the
 * pointer's ray meets the ground, at every height and angle a camera can
 * take. Over random planar ground (any height, any tilt) and random rays
 * pointing down at it, the march must land ON the ground (its point's
 * height over the ground about 0) at the analytic distance, and never
 * report a hit for a ray pointing away from it. A plane keeps the
 * expected answer exact, so the property tests the march and the
 * bisection, not a model of the Earth.
 */
import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { GROUND_HIT, groundReachM, marchToGround } from "./globe-ground-hit.js";

/**
 * The ridge property draws flanks up to the slope the step bound assumes
 * (rise per run). Steeper flanks than that CAN be stepped through: drawn
 * up to 6 or 12, 20 000 runs each shrank to a missed ridge at a slope of
 * 4.0 and 5.8.
 */
const RIDGE_SLOPE_MAX = GROUND_HIT.maxSlope;
const REACH_M = GROUND_HIT.maxDistanceM;
const LEAST_STEP_M = GROUND_HIT.minStepM;
const STEP_PER_M = GROUND_HIT.stepPerM;

/** Even over [min, max] (fc.double piles its draws near 0; arbitraries.ts). */
const evenly = (min: number, max: number) =>
  fc
    .integer({ min: 0, max: 1_000_000 })
    .map((i) => min + ((max - min) * i) / 1_000_000);

/** Even in the logarithm over [min, max]: as many draws near 1 m as near 1 km. */
const logEvenly = (min: number, max: number) =>
  evenly(Math.log(min), Math.log(max)).map(Math.exp);

/** A plane through (0, groundM, 0) with normal `n`: signed height over it. */
const planeAbove =
  (n: THREE.Vector3, groundM: number) =>
  (p: THREE.Vector3): number =>
    n.x * p.x + n.y * (p.y - groundM) + n.z * p.z;

const unit = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .map(([x, y, z]) => new THREE.Vector3(x, y, z))
  .filter((v) => v.length() > 0.1)
  .map((v) => v.normalize());

describe("marchToGround over random planes", () => {
  it("lands on the ground at the analytic distance", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 4_000, noNaN: true }),
        // The ground tilted up to about 45 degrees.
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 0.5, max: 300, noNaN: true }),
        unit,
        (groundM, tiltX, tiltZ, aboveM, dir) => {
          const n = new THREE.Vector3(tiltX, 1, tiltZ).normalize();
          const above = planeAbove(n, groundM);
          const origin = new THREE.Vector3(0, groundM + aboveM / n.y, 0);
          const toward = dir.dot(n);
          const hit = marchToGround(new THREE.Ray(origin, dir), above);
          const expected = -above(origin) / toward;
          // A crossing right at the reach's end may fall either side.
          fc.pre(Math.abs(expected - 5_000) > 1);
          // A ray all but parallel to the plane (its height changing by
          // under 5 mm over the reach) reads level, either reason.
          fc.pre(Math.abs(toward) > 1e-6);
          // Away from the ground ("above"), or towards it but past the
          // reach ("out-of-reach"): no hit.
          const reason =
            toward >= 0 ? "above" : expected < 5_000 ? null : "out-of-reach";
          expect(hit.miss).toBe(reason);
          expect(
            hit.miss === null ? Math.abs(above(hit.point)) : 0,
          ).toBeLessThan(1e-3);
          expect(
            hit.miss === null ? Math.abs(hit.t - expected) : 0,
          ).toBeLessThan(1e-3);
        },
      ),
      { numRuns: 300 },
    );
  });
});

/**
 * A y-up world: flat ground at y = 0 and one ridge across the ray's way, a
 * triangle with its apex at x = `apexX`, `heightM` tall, flanks of slope
 * `slope` (rise per run): its signed height over the ground, and every
 * stretch of a ray where it is under the ground, exactly.
 */
function ridgeWorld(apexX: number, heightM: number, slope: number) {
  const ground = (x: number) =>
    Math.max(0, heightM - slope * Math.abs(x - apexX));
  const above = (p: THREE.Vector3) => p.y - ground(p.x);
  /** The ray from (0, h, 0) pitched `pitch` (radians, above -90 degrees). */
  const underground = (h: number, pitch: number, reachM: number) => {
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    const f = (t: number) => h + t * s - ground(t * c);
    // The height over the ground is linear between the ridge's corners.
    const knots = [0, reachM];
    const halfWidth = heightM / slope;
    for (const x of [apexX - halfWidth, apexX, apexX + halfWidth]) {
      const t = x / c;
      if (t > 0 && t < reachM) knots.push(t);
    }
    return stretchesUnder(
      f,
      knots.sort((a, b) => a - b),
    );
  };
  return { above, underground };
}

/**
 * The stretches where `f` (linear between consecutive `knots`) is at or
 * under 0, after starting above it; the last one may run to the last knot.
 */
function stretchesUnder(f: (t: number) => number, knots: number[]) {
  const stretches: { from: number; to: number }[] = [];
  let entry: number | null = null;
  for (let i = 0; i + 1 < knots.length; i++) {
    const a = knots[i]!;
    const b = knots[i + 1]!;
    const fa = f(a);
    const fb = f(b);
    if (entry === null && fa > 0 && fb <= 0) {
      entry = a + (fa / (fa - fb)) * (b - a);
    } else if (entry !== null && fa <= 0 && fb > 0) {
      stretches.push({ from: entry, to: a + (fa / (fa - fb)) * (b - a) });
      entry = null;
    }
  }
  if (entry !== null) stretches.push({ from: entry, to: knots.at(-1)! });
  return stretches;
}

describe("marchToGround over a ridge (the step bound)", () => {
  // Why this property matters: the march's step must never carry it
  // through the relief and out again. With a step that grew with the
  // distance (2 % of it), a grazing first-person ray stepped over a ridge
  // it went metres into and picked the ground behind the hill. The step
  // from a sample is bounded by the height measured there, so on ground no
  // steeper than the assumed slope every underground stretch longer than
  // the least step at its distance (max(minStepM, stepPerM x t)) is found,
  // and the hit is its entry: the first ground the ray meets. Swept over eye height to 3 km, pitches from nearly
  // straight down to slightly up, ridges near and far, gentle and steep,
  // pierced deep and passed over (a ridge under the ray must NOT be
  // picked; the ground behind it is).
  it("finds the first ground the ray meets, never the ground behind a ridge", () => {
    fc.assert(
      fc.property(
        logEvenly(0.5, 3_000),
        evenly(-89, 10),
        // The ridge's apex along the way, as a share of the distance to
        // where the ray meets flat ground (or of the reach).
        evenly(0.02, 1.2),
        // How far the apex reaches above the ray there (or under it).
        logEvenly(0.05, 200),
        fc.boolean(),
        evenly(0.05, RIDGE_SLOPE_MAX),
        (h, pitchDeg, apexShare, pierceM, under, slope) => {
          const pitch = (pitchDeg * Math.PI) / 180;
          const flatT = pitch < 0 ? -h / Math.sin(pitch) : Infinity;
          const apexT = apexShare * Math.min(flatT, REACH_M);
          const rayAtApex = h + apexT * Math.sin(pitch);
          const heightM =
            rayAtApex + (under ? -Math.min(pierceM, 20) : pierceM);
          fc.pre(heightM > 0.01);
          const world = ridgeWorld(apexT * Math.cos(pitch), heightM, slope);
          // The ray starts above the ground, not inside the ridge's flank.
          fc.pre(world.above(new THREE.Vector3(0, h, 0)) > 0.01);
          const first = world.underground(h, pitch, REACH_M)[0];
          // A first stretch shorter than the least step at its distance
          // may be stepped over; one starting right at the reach may fall
          // either side.
          fc.pre(
            !first ||
              first.to - first.from >=
                Math.max(LEAST_STEP_M, STEP_PER_M * first.from),
          );
          fc.pre(!first || Math.abs(first.from - REACH_M) > 1);
          const dir = new THREE.Vector3(Math.cos(pitch), Math.sin(pitch), 0);
          const hit = marchToGround(
            new THREE.Ray(new THREE.Vector3(0, h, 0), dir),
            world.above,
          );
          // No ground ahead within the reach: no hit; else its entry.
          expect(hit.miss === null, `the ground at ${first?.from}`).toBe(
            first !== undefined,
          );
          expect(
            hit.miss === null && first ? Math.abs(hit.t - first.from) : 0,
          ).toBeLessThan(1e-3);
        },
      ),
      { numRuns: 2_000 },
    );
  });
});

describe("groundReachM", () => {
  // Why: the editor passes this reach for its camera's height, so a
  // higher camera must never reach less (an overview that picked from 2 km
  // must still pick from 3 km), and no camera less than the default.
  it("grows with the height and never drops below the default", () => {
    fc.assert(
      fc.property(logEvenly(0.01, 20_000), logEvenly(0.01, 20_000), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(groundReachM(low)).toBeLessThanOrEqual(groundReachM(high));
        expect(groundReachM(low)).toBeGreaterThanOrEqual(
          GROUND_HIT.maxDistanceM,
        );
      }),
      { numRuns: 300 },
    );
  });
});
