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

import { marchToGround } from "./globe-ground-hit.js";

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
          // Away from the ground, or past the reach: no hit.
          const reachable = toward < 0 && expected < 5_000;
          expect(hit !== null).toBe(reachable);
          expect(hit ? Math.abs(above(hit.point)) : 0).toBeLessThan(1e-3);
          expect(hit ? Math.abs(hit.t - expected) : 0).toBeLessThan(1e-3);
        },
      ),
      { numRuns: 300 },
    );
  });
});
