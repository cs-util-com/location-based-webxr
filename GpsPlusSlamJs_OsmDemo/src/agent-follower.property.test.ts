/**
 * The follower's corridor property (DEC-R13-5, as bounded by DEC-R13-14).
 *
 * Why this test matters:
 * It is the one that decides whether DEC-R13-5 survives. That decision chose
 * TUNING over clamping — mass and damping picked so the smoothed position cannot
 * leave the corridor the planner cleared — and recorded in the same breath that
 * this is a tuning claim rather than a construction guarantee. A tuning claim in
 * a comment is unfalsifiable; here it is a property, and if it fails the decision
 * is wrong rather than the numbers, and clamping comes back.
 *
 * WHY IT IS BOUNDED AT THE SHIPPED SPEED (DEC-R13-14). Critical damping bounds
 * overshoot past a STATIONARY target; against a MOVING one a lagging follower
 * always cuts the inside of a corner, and the cut grows without bound with
 * speed. Quantifying over speed would make this false by construction rather
 * than falsifiable — so the speed is held at `AGENT_SPEED_MPS` and named, and
 * everything the maths CAN cover is quantified: corner angle, corner count,
 * segment length and step size.
 *
 * WHY THE CORNERS ARE HEX CORNERS. The polyline is a list of res-13 cell
 * centres, so its vertices turn by multiples of 60° and its segments are one
 * cell-centre spacing long. Generating arbitrary geometry would test a follower
 * against paths the planner cannot produce, and would say nothing about the one
 * it can.
 *
 * @see agent-follower.ts.md
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  FOLLOWER_MAX_DEVIATION_M,
  followerAt,
  stepFollower,
  type Follower,
} from "./agent-follower.js";
import { AGENT_SPEED_MPS, pathLengthM, pointAlong } from "./route-path.js";
import type { ScenePoint } from "./pick.js";

/** Centre-to-centre spacing of adjacent res-13 cells: edge 4.09 m × √3. */
const CELL_SPACING_M = 4.09 * Math.sqrt(3);

/** The six directions a hex neighbour can lie in. */
const HEX_HEADINGS = [0, 1, 2, 3, 4, 5];

/**
 * A route-shaped polyline: unit steps at hex headings, never doubling back.
 *
 * The no-reversal rule is not cosmetic — a planned route never revisits a cell,
 * so a 180° vertex is geometry the follower will never be shown, and including
 * it would fail the property on a case that cannot occur.
 */
const routePath = fc
  .array(fc.constantFrom(...HEX_HEADINGS), { minLength: 1, maxLength: 12 })
  .map((headings) => {
    const points: ScenePoint[] = [{ x: 0, y: 0, z: 0 }];
    let previous: number | undefined;
    for (const heading of headings) {
      // Skip a step that would reverse the last one.
      if (previous !== undefined && (heading + 3) % 6 === previous) continue;
      previous = heading;
      const angle = (heading * Math.PI) / 3;
      const last = points[points.length - 1]!;
      points.push({
        x: last.x + Math.cos(angle) * CELL_SPACING_M,
        y: 0,
        z: last.z + Math.sin(angle) * CELL_SPACING_M,
      });
    }
    return points;
  })
  .filter((points) => points.length > 1);

const distance = (a: ScenePoint, b: ScenePoint): number =>
  Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

function distanceToSegment(
  point: ScenePoint,
  a: ScenePoint,
  b: ScenePoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  if (lengthSq === 0) return distance(point, a);
  const along = Math.min(
    1,
    Math.max(
      0,
      ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) /
        lengthSq,
    ),
  );
  return distance(point, {
    x: a.x + dx * along,
    y: a.y + dy * along,
    z: a.z + dz * along,
  });
}

/** How far `point` strays from the whole polyline. */
function distanceToPath(point: ScenePoint, path: readonly ScenePoint[]) {
  let best = Number.POSITIVE_INFINITY;
  for (let at = 1; at < path.length; at += 1) {
    best = Math.min(best, distanceToSegment(point, path[at - 1]!, path[at]!));
  }
  return best;
}

describe("the follower stays in the corridor the planner cleared", () => {
  it("never strays further than a cell's inradius, at any corner and any step", () => {
    fc.assert(
      fc.property(
        routePath,
        // From a 144 Hz display to a throttled tab. Quantified because the
        // integrator's stability at large steps is exactly what makes the
        // claim frame-rate independent rather than true at 60 Hz.
        fc.double({ min: 1 / 240, max: 1 / 15, noNaN: true }),
        (path, dtS) => {
          let follower: Follower = followerAt(path[0]!);
          let walkedM = 0;
          let worst = 0;
          const totalM = pathLengthM(path);

          // Past arrival by a margin, so the settle at the final vertex counts:
          // the follower is still metres behind when the WALK reports done.
          for (
            let elapsed = 0;
            elapsed < totalM / AGENT_SPEED_MPS + 3;
            elapsed += dtS
          ) {
            walkedM += AGENT_SPEED_MPS * dtS;
            const target = pointAlong(path, walkedM)!;
            follower = stepFollower(follower, target.point, dtS);
            // ACCUMULATED, NOT ASSERTED, INSIDE THE LOOP. A `expect` per step is
            // thousands of matcher calls per run and tens of thousands per
            // property; it made this pass alone and TIME OUT under full-suite
            // load, which is a flake rather than a failure. The worst value is
            // what the claim is about anyway.
            worst = Math.max(worst, distanceToPath(follower.position, path));
          }
          expect(worst).toBeLessThanOrEqual(FOLLOWER_MAX_DEVIATION_M);
        },
      ),
      { numRuns: 1000 },
    );
  });

  /**
   * AND IT ARRIVES. A follower bounded inside the corridor but lagging for ever
   * would satisfy the property above while never reaching the destination — the
   * corridor claim and the arrival claim fail in opposite directions, so both
   * have to be made.
   */
  it("ends up at the end of the path", () => {
    fc.assert(
      fc.property(routePath, (path) => {
        let follower: Follower = followerAt(path[0]!);
        let walkedM = 0;
        const dtS = 1 / 60;
        const totalM = pathLengthM(path);
        for (
          let elapsed = 0;
          elapsed < totalM / AGENT_SPEED_MPS + 3;
          elapsed += dtS
        ) {
          walkedM += AGENT_SPEED_MPS * dtS;
          follower = stepFollower(
            follower,
            pointAlong(path, walkedM)!.point,
            dtS,
          );
        }
        expect(
          distance(follower.position, path[path.length - 1]!),
        ).toBeLessThan(0.05);
      }),
      { numRuns: 1000 },
    );
  });
});
