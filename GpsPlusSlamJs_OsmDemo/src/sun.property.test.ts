/**
 * The property that stops the sun becoming a headlight (W12, DEC-R4-6).
 *
 * WHY THIS IS A PROPERTY TEST AND NOT AN EXAMPLE. The requirement is not "at
 * this camera angle the light is over there"; it is that **for every camera
 * position the demo can reach**, the light is never near the eye. A headlight
 * makes N·L maximal and nearly constant across every surface facing the viewer,
 * which flattens exactly the contours the reflective ground was introduced to
 * reveal — and it is invisible in a screenshot taken from one angle, because
 * from one angle a flat-lit scene just looks like a scene.
 *
 * That is a claim over a continuum, so it is asserted over one: a few example
 * azimuths would pass for an offset of zero at whichever angles happened to be
 * chosen.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  MIN_SUN_EYE_ANGLE_RAD,
  SUN_AZIMUTH_OFFSET_RAD,
  SUN_ELEVATION_RAD,
  cameraAzimuth,
  sunDirection,
  type Vector3Like,
} from "./sun.js";

function dot(a: Vector3Like, b: Vector3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalise(v: Vector3Like): Vector3Like {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/** A camera somewhere on a dome around the origin, as MapControls allows. */
const cameraArb = fc
  .record({
    azimuth: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
    // MapControls clamps the polar angle away from straight down; the demo's
    // camera lives well above the ground.
    elevation: fc.double({ min: 0.05, max: Math.PI / 2 - 0.05, noNaN: true }),
    distance: fc.double({ min: 20, max: 3000, noNaN: true }),
  })
  .map(({ azimuth, elevation, distance }) => ({
    x: distance * Math.cos(elevation) * Math.sin(azimuth),
    y: distance * Math.sin(elevation),
    z: distance * Math.cos(elevation) * Math.cos(azimuth),
  }));

describe("the sun is never a headlight", () => {
  it("stays at least MIN_SUN_EYE_ANGLE_RAD away from the eye, always", () => {
    fc.assert(
      fc.property(cameraArb, (camera) => {
        const origin = { x: 0, y: 0, z: 0 };
        const sun = sunDirection(cameraAzimuth(camera, origin));
        // The eye direction as seen from the scene — the same convention as
        // `sunDirection`, so the angle between them is the quantity that
        // decides whether the light is a headlight.
        const eye = normalise(camera);
        const angle = Math.acos(Math.min(1, Math.max(-1, dot(sun, eye))));
        expect(angle).toBeGreaterThanOrEqual(MIN_SUN_EYE_ANGLE_RAD);
      }),
      { numRuns: 400 },
    );
  });

  it("keeps the sun above the horizon and at a constant height", () => {
    // The elevation is what makes relief read: a high sun lights every facet
    // equally. Fixing it here means orbiting cannot accidentally raise it.
    fc.assert(
      fc.property(cameraArb, (camera) => {
        const sun = sunDirection(cameraAzimuth(camera, { x: 0, y: 0, z: 0 }));
        expect(sun.y).toBeCloseTo(Math.sin(SUN_ELEVATION_RAD), 12);
        expect(sun.y).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it("returns a unit vector, so a caller can scale it to any distance", () => {
    fc.assert(
      fc.property(fc.double({ min: -10, max: 10, noNaN: true }), (azimuth) => {
        const sun = sunDirection(azimuth);
        expect(Math.hypot(sun.x, sun.y, sun.z)).toBeCloseTo(1, 12);
      }),
      { numRuns: 200 },
    );
  });

  it("holds the offset from the camera exactly, at every azimuth", () => {
    // The relationship the whole approach rests on: the sun keeps a CONSTANT
    // angular relationship to the view, which is what stops the highlight from
    // being lost as the camera orbits. A drifting offset would still pass the
    // "not a headlight" floor while making the lighting unpredictable.
    fc.assert(
      fc.property(cameraArb, (camera) => {
        const azimuth = cameraAzimuth(camera, ORIGIN);
        const sun = sunDirection(azimuth);
        const sunAzimuth = Math.atan2(sun.x, sun.z);
        // Compared as a direction rather than as a number: azimuths wrap, and
        // `-π` and `π` are the same heading.
        const expected = azimuth + SUN_AZIMUTH_OFFSET_RAD;
        expect(Math.cos(sunAzimuth - expected)).toBeCloseTo(1, 10);
      }),
      { numRuns: 200 },
    );
  });

  it("turns with the camera rather than staying put", () => {
    // The other half of the requirement, and the one an offset of zero would
    // also satisfy: the highlight must not be lost as the view orbits, which
    // means the sun has to MOVE. A fixed sun would pass every assertion above.
    const a = sunDirection(cameraAzimuth({ x: 100, y: 80, z: 0 }, ORIGIN));
    const b = sunDirection(cameraAzimuth({ x: 0, y: 80, z: 100 }, ORIGIN));
    expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)).toBeGreaterThan(0.5);
  });
});

const ORIGIN = { x: 0, y: 0, z: 0 };

describe("cameraAzimuth", () => {
  it("measures from the TARGET, not from world zero", () => {
    // After a pan the camera and its target are both far from the origin, and
    // an azimuth measured from world zero would swing wildly while the user is
    // only sliding sideways — the sun would spin during a pan.
    const straightNorth = cameraAzimuth(
      { x: 500, y: 80, z: 600 },
      { x: 500, y: 0, z: 500 },
    );
    expect(straightNorth).toBeCloseTo(0, 12);
  });

  it("is 0 for a camera directly overhead, rather than NaN", () => {
    // Degenerate rather than wrong: from straight above, every azimuth looks
    // the same. `atan2(0, 0)` is 0 in JS anyway, but relying on that silently
    // would leave the case undocumented.
    expect(cameraAzimuth({ x: 0, y: 100, z: 0 }, ORIGIN)).toBe(0);
  });
});
