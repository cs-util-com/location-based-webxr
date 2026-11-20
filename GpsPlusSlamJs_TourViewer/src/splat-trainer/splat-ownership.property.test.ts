import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { Quaternion, Vector3 } from "gps-plus-slam-app-framework/core";

import { SYNTHETIC_PROJECTION } from "../test-support/synthetic-recording.js";
import {
  createOwnership,
  sees,
  shellCrop,
  type OwnershipCamera,
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
          // Spans both sides of every swept 2 x ownRangeM.
          along: fc.double({ min: 0, max: 400, noNaN: true }),
        }),
        { minLength: 1, maxLength: 24 },
      ),
      ownRangeM: fc.constantFrom(20, 40, 80),
    });
  });

const dist = (a: Vector3, b: Vector3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Rules 1 to 4 of `createOwnership`, written out by brute force over
 *  every camera and every pair: the reference the grid-backed version
 *  must match exactly, ties included (the lower camera index wins). */
function referenceOwner(
  cameras: readonly OwnershipCamera[],
  windows: readonly OwnershipWindow[],
  range: number,
  p: Vector3,
): number {
  const byNearest = (a: number, b: number): number =>
    dist(cameras[a]?.position ?? p, p) - dist(cameras[b]?.position ?? p, p) ||
    a - b;
  const seeing = [...cameras.keys()].filter((i) => {
    const c = cameras[i];
    return c !== undefined && sees(c, P, p);
  });
  const inRange = seeing.filter(
    (i) => dist(cameras[i]?.position ?? p, p) <= range,
  );
  if (inRange.length === 0) {
    const nearest = [...seeing].sort(byNearest)[0];
    return nearest === undefined ? -1 : (cameras[nearest]?.window ?? -1);
  }
  const nearest = [...inRange].sort(byNearest)[0] ?? -1;
  const n = cameras[nearest]?.window ?? -1;
  const revisit = (w: number, v: number): boolean => {
    if (windows[w]?.segment !== windows[v]?.segment) return true;
    for (const a of inRange) {
      for (const b of inRange) {
        const ca = cameras[a];
        const cb = cameras[b];
        if (ca?.window !== w || cb?.window !== v) continue;
        if (Math.abs(ca.along - cb.along) <= 2 * range) return false;
      }
    }
    return true;
  };
  let first = n;
  for (const i of inRange) {
    const w = cameras[i]?.window ?? n;
    if (w < first && revisit(w, n)) first = w;
  }
  if (first === n) return n;
  // The nearest seeing camera of the first pass's windows before n.
  const firstPass = inRange.filter((i) => {
    const w = cameras[i]?.window ?? n;
    return w < n && !revisit(w, first);
  });
  const owner = [...firstPass].sort(byNearest)[0];
  return owner === undefined ? first : (cameras[owner]?.window ?? first);
}

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

  it("matches a brute-force reference of its rules for any scene, ties included", () => {
    // Why: the grid only speeds the search up; any spot the grid misses,
    // any range it ignores, any tie it breaks by cell order instead of
    // camera order, and any revisit decided other than by distance along
    // the walk shows up as a difference here.
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
            expect(own.ownerOf(p)).toBe(
              referenceOwner(scene.cameras, scene.windows, scene.ownRangeM, p),
            );
          }
        },
      ),
      RUNS,
    );
  });

  it("matches the reference when cameras share positions exactly", () => {
    // Why: equal distances are where a grid's cell order and the camera
    // order can disagree; whole-metre cameras, some on one spot, force
    // them.
    const gridPoint = fc.tuple(
      fc.integer({ min: -3, max: 3 }),
      fc.constant(0),
      fc.integer({ min: -3, max: 3 }),
    ) as fc.Arbitrary<Vector3>;
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            position: gridPoint,
            window: fc.integer({ min: 0, max: 3 }),
            along: fc.constantFrom(0, 10, 200),
          }),
          { minLength: 1, maxLength: 16 },
        ),
        fc.array(gridPoint, { maxLength: 10 }),
        (cams, points) => {
          const windows = [0, 0, 0, 1].map((segment) => ({ segment }));
          const cameras = cams.map((c): OwnershipCamera => ({
            ...c,
            rotation: [0, 0, 0, 1],
          }));
          const own = createOwnership(cameras, windows, P, 20);
          for (const [x, , z] of points) {
            const p: Vector3 = [x, -1, z - 4];
            expect(own.ownerOf(p)).toBe(
              referenceOwner(cameras, windows, 20, p),
            );
          }
        },
      ),
      RUNS,
    );
  });

  it("gives every spot of a straight forward walk to its nearest seeing camera, at any window length and range", () => {
    // Why: one pass along a straight line is never a revisit, however
    // far the window two back can see. Deciding a revisit by window index
    // gave the start of every window to a window that saw it from afar.
    fc.assert(
      fc.property(
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: 0.5, max: 2, noNaN: true }),
        fc.integer({ min: 20, max: 150 }),
        fc.constantFrom(15, 30, 60),
        fc.constantFrom(20, 40, 80),
        fc.array(
          fc.tuple(
            fc.double({ min: 0, max: 1, noNaN: true }),
            fc.double({ min: -4, max: 4, noNaN: true }),
            fc.double({ min: -3, max: 1, noNaN: true }),
          ),
          { maxLength: 20 },
        ),
        (yaw, stepM, count, windowM, range, spots) => {
          const dx = -Math.sin(yaw);
          const dz = -Math.cos(yaw);
          const rotation: Quaternion = [
            0,
            Math.sin(yaw / 2),
            0,
            Math.cos(yaw / 2),
          ];
          const cameras = Array.from(
            { length: count },
            (_, i): OwnershipCamera => ({
              position: [i * stepM * dx, 0, i * stepM * dz],
              rotation,
              window: Math.floor((i * stepM) / windowM),
              along: i * stepM,
            }),
          );
          const windowCount = (cameras.at(-1)?.window ?? 0) + 1;
          const windows = Array.from({ length: windowCount }, () => ({
            segment: 0,
          }));
          const own = createOwnership(cameras, windows, P, range);
          const length = count * stepM;
          for (const [t, side, y] of spots) {
            // Ahead of the walk's start, a little to either side.
            const s = t * length;
            const p: Vector3 = [s * dx - side * dz, y, s * dz + side * dx];
            const seeing = cameras
              .map((c, i) => ({ c, i, d: dist(c.position, p) }))
              .filter(({ c, d }) => d <= range && sees(c, P, p))
              .sort((a, b) => a.d - b.d || a.i - b.i);
            const nearest = seeing[0];
            if (nearest === undefined) continue;
            expect(own.ownerOf(p)).toBe(nearest.c.window);
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
