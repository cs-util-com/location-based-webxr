/**
 * The physical sun: a time of day, an elevation, an azimuth, a direction.
 *
 * WHY THESE TESTS MATTER. This module REVERSES DEC-R4-6, under which the sun's
 * azimuth followed the camera so a specular highlight was never lost as the eye
 * orbited. That was the right answer for a painted sky and the wrong one for a
 * scattering shader, because a sun that tracks the camera makes the whole sky
 * spin as you pan — which reads as a bug rather than as lighting (DEC-R6-3).
 *
 * The arithmetic here is the part that can be wrong in a way you would only
 * notice by looking: a sun that rises in the west, an azimuth that jumps by 2π
 * mid-sweep, a direction vector that is not unit length so the `DirectionalLight`
 * and the sky shader disagree about where the sun is. None of that throws, and
 * a GPU cannot be asked about it in CI — so it is proved here, in JS, exactly as
 * `sampleTerrainTexture` is proved against `heightAt`.
 *
 * The compass convention is asserted rather than assumed, because it is the one
 * thing a reader cannot recover from the code: azimuth is measured CLOCKWISE
 * FROM NORTH, and north is the render frame's −z.
 */

import { describe, expect, it } from "vitest";

import { solarPosition } from "gps-plus-slam-app-framework/geo/solar-position";

import { PICKER_PLACES } from "./picker-places.js";
import { bootInstant } from "./sun-clock.js";
import { MIN_SUN_EYE_ANGLE_RAD, sunDirection } from "./sun-position.js";

/** Length of a direction vector, for the unit-length invariant. */
function length(v: { x: number; y: number; z: number }): number {
  return Math.hypot(v.x, v.y, v.z);
}

const DEG = Math.PI / 180;

describe("sunDirection — the compass convention", () => {
  it("points NORTH along −z, which is the render frame's north", () => {
    // The single fact a reader cannot recover from the code. `mesh-data.ts` and
    // `cell-mesh.ts` both put north on −z; a sun module that disagreed would
    // light the city from the wrong side and nothing would report it.
    const north = sunDirection({ elevationRad: 0, azimuthRad: 0 });
    expect(north.z).toBeCloseTo(-1, 9);
    expect(north.x).toBeCloseTo(0, 9);
    expect(north.y).toBeCloseTo(0, 9);
  });

  it("measures azimuth CLOCKWISE, so 90° is east (+x)", () => {
    const east = sunDirection({ elevationRad: 0, azimuthRad: 90 * DEG });
    expect(east.x).toBeCloseTo(1, 9);
    expect(east.z).toBeCloseTo(0, 9);
  });

  it("puts south on +z and west on −x", () => {
    const south = sunDirection({ elevationRad: 0, azimuthRad: 180 * DEG });
    expect(south.z).toBeCloseTo(1, 9);
    const west = sunDirection({ elevationRad: 0, azimuthRad: 270 * DEG });
    expect(west.x).toBeCloseTo(-1, 9);
  });

  it("puts elevation on +y, so the zenith is straight up", () => {
    const zenith = sunDirection({ elevationRad: 90 * DEG, azimuthRad: 0 });
    expect(zenith.y).toBeCloseTo(1, 9);
  });

  it("returns a UNIT vector at every input", () => {
    // Not cosmetic: the same vector positions the DirectionalLight and drives
    // the sky shader's `sunPosition`. A non-unit one makes the painted sun and
    // the lit highlights disagree, which is the two-derivations-of-one-thing
    // defect this project keeps removing — and it would look like a mystery.
    for (let e = -20; e <= 90; e += 7) {
      for (let a = 0; a < 360; a += 13) {
        const v = sunDirection({ elevationRad: e * DEG, azimuthRad: a * DEG });
        expect(length(v)).toBeCloseTo(1, 9);
      }
    }
  });
});

describe("the sun is not a headlight, at boot", () => {
  it("stays well off the eye vector for the default camera, everywhere and all year", () => {
    // WHAT THIS PRESERVES FROM DEC-R4-6, and why it is now conditional. The
    // old sun could never be a headlight because it was pinned 45° off the
    // camera; a physical sun can be anywhere, and a sun directly behind the
    // viewer flattens the scene completely: N·L becomes maximal and nearly
    // constant for every surface facing you. That is the flash-photography
    // look, and it destroys exactly the relief §2's slope treatment exists to
    // reveal.
    //
    // It is asserted where a first-time viewer meets the sun: the BOOT sun,
    // which is now the REAL evening golden hour, so it moves with the date and
    // the place. Swept over every place the picker offers and every month
    // (plan 2026-09-23-2149, review finding 13).
    const camera = { x: 140, y: 110, z: 140 };
    const target = { x: 0, y: 10, z: 0 };
    const eye = {
      x: camera.x - target.x,
      y: camera.y - target.y,
      z: camera.z - target.z,
    };
    const eyeLength = length(eye);
    let smallest = Math.PI;
    for (const place of PICKER_PLACES) {
      const at = { lat: place.position.lat, lng: place.position.lng };
      for (let month = 1; month <= 12; month++) {
        const t = bootInstant({ year: 2026, month, day: 21 }, at);
        const p = solarPosition(t, at.lat, at.lng);
        const sun = sunDirection({
          elevationRad: p.elevationRad,
          azimuthRad: p.azimuthRad,
        });
        const cos = (eye.x * sun.x + eye.y * sun.y + eye.z * sun.z) / eyeLength;
        smallest = Math.min(
          smallest,
          Math.acos(Math.max(-1, Math.min(1, cos))),
        );
      }
    }
    expect(smallest).toBeGreaterThan(MIN_SUN_EYE_ANGLE_RAD);
  });
});
