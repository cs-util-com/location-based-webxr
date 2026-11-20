import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { Quaternion, Vector3 } from "gps-plus-slam-app-framework/core";

import { SYNTHETIC_PROJECTION } from "../test-support/synthetic-recording.js";
import {
  createOwnership,
  sees,
  shellCrop,
  type OwnershipWindow,
} from "./splat-ownership.js";

/**
 * Why these properties matter: the merge keeps a splat in window w only
 * when `ownerOf(splat) === w`. A splat kept twice doubles a surface; one
 * taken from the only window that saw it leaves a hole; a revisited spot
 * kept from two windows shows two slightly shifted copies. These must
 * hold for any cameras and any points, not only the examples.
 */

const P = SYNTHETIC_PROJECTION;
const RUNS = { numRuns: 200 };

const coord = fc.double({ min: -60, max: 60, noNaN: true });
const pointArb = fc.tuple(
  coord,
  fc.double({ min: -5, max: 5, noNaN: true }),
  coord,
) as fc.Arbitrary<Vector3>;

/** A unit quaternion turning about y (a walker's heading) and a little
 *  about x (looking up or down). */
const rotationArb = fc
  .tuple(
    fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
    fc.double({ min: -0.4, max: 0.4, noNaN: true }),
  )
  .map(([yaw, pitch]): Quaternion => {
    const cy = Math.cos(yaw / 2);
    const sy = Math.sin(yaw / 2);
    const cp = Math.cos(pitch / 2);
    const sp = Math.sin(pitch / 2);
    // yaw (about y) then pitch (about x): q = qy * qx
    return [cy * sp, sy * cp, -sy * sp, cy * cp];
  });

/** Windows in segments (segment numbers ascending, as a plan gives them)
 *  and cameras naming them. */
const sceneArb = fc
  .array(fc.boolean(), { minLength: 1, maxLength: 8 })
  .chain((newSegment) => {
    let segment = 0;
    const windows: OwnershipWindow[] = newSegment.map((cut, i) => {
      if (cut && i > 0) segment += 1;
      return { segment };
    });
    return fc.record({
      windows: fc.constant(windows),
      cameras: fc.array(
        fc.record({
          position: pointArb,
          rotation: rotationArb,
          window: fc.integer({ min: 0, max: windows.length - 1 }),
        }),
        { minLength: 1, maxLength: 24 },
      ),
      ownRangeM: fc.constantFrom(20, 40, 80),
    });
  });

describe("createOwnership (property)", () => {
  it("names at most one window per spot, and only one whose camera sees it", () => {
    fc.assert(
      fc.property(
        sceneArb,
        fc.array(pointArb, { maxLength: 20 }),
        (scene, points) => {
          const own = createOwnership(
            scene.cameras,
            scene.windows,
            P,
            scene.ownRangeM,
          );
          for (const p of points) {
            const owner = own.ownerOf(p);
            const seeing = scene.cameras.filter((c) => sees(c, P, p));
            expect([-1, ...seeing.map((c) => c.window)]).toContain(owner);
            expect(owner === -1).toBe(seeing.length === 0);
            // A function of the position alone: asking again gives the same.
            expect(own.ownerOf(p)).toBe(owner);
          }
        },
      ),
      RUNS,
    );
  });

  it("never takes a spot from the one window whose cameras alone see it", () => {
    fc.assert(
      fc.property(
        sceneArb,
        fc.array(pointArb, { maxLength: 20 }),
        (scene, points) => {
          const own = createOwnership(
            scene.cameras,
            scene.windows,
            P,
            scene.ownRangeM,
          );
          for (const p of points) {
            const seeing = new Set(
              scene.cameras.filter((c) => sees(c, P, p)).map((c) => c.window),
            );
            const only = seeing.size === 1 ? [...seeing][0] : undefined;
            expect(only === undefined || own.ownerOf(p) === only).toBe(true);
          }
        },
      ),
      RUNS,
    );
  });

  it("never gives a revisited spot to the later of two windows that both see it in range", () => {
    // Two windows are a revisit when they are not neighbours: different
    // segments, or more than one apart in the walk.
    fc.assert(
      fc.property(
        sceneArb,
        fc.array(pointArb, { maxLength: 20 }),
        (scene, points) => {
          const own = createOwnership(
            scene.cameras,
            scene.windows,
            P,
            scene.ownRangeM,
          );
          const neighbours = (a: number, b: number): boolean =>
            Math.abs(a - b) <= 1 &&
            scene.windows[a]?.segment === scene.windows[b]?.segment;
          for (const p of points) {
            const inRange = new Set(
              scene.cameras
                .filter(
                  (c) =>
                    Math.hypot(
                      c.position[0] - p[0],
                      c.position[1] - p[1],
                      c.position[2] - p[2],
                    ) <= scene.ownRangeM && sees(c, P, p),
                )
                .map((c) => c.window),
            );
            const owner = own.ownerOf(p);
            // Earlier, non-neighbouring windows that see it in range: the
            // keeping window must not be later than any of them.
            expect(
              [...inRange].filter(
                (earlier) => earlier < owner && !neighbours(earlier, owner),
              ),
            ).toEqual([]);
          }
        },
      ),
      RUNS,
    );
  });
});

describe("shellCrop (property)", () => {
  it("keeps exactly the points within the keep distance of a camera", () => {
    fc.assert(
      fc.property(
        fc.array(pointArb, { maxLength: 30 }),
        fc.array(pointArb, { maxLength: 8 }),
        fc.double({ min: 0.5, max: 80, noNaN: true }),
        (points, cameras, keepM) => {
          const keep = shellCrop(points, cameras, keepM);
          points.forEach((p, i) => {
            const near = cameras.some(
              (c) => Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) <= keepM,
            );
            expect(keep[i]).toBe(near);
          });
        },
      ),
      RUNS,
    );
  });
});
