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

import {
  DEFAULT_TIME_OF_DAY,
  MAX_SUN_ELEVATION_RAD,
  MIN_SUN_EYE_ANGLE_RAD,
  cameraAzimuth,
  sunAt,
  sunDirection,
} from "./sun-position.js";

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

describe("sunAt — the time of day", () => {
  it("is highest at noon and symmetric about it", () => {
    // The shape of a day. Asymmetry here would mean morning and evening light
    // differed in elevation, which is the one thing a viewer would notice
    // without being able to name.
    const noon = sunAt(0.5);
    expect(noon.elevationRad).toBeCloseTo(MAX_SUN_ELEVATION_RAD, 9);
    for (const d of [0.1, 0.2, 0.3, 0.4]) {
      expect(sunAt(0.5 - d).elevationRad).toBeCloseTo(
        sunAt(0.5 + d).elevationRad,
        9,
      );
    }
  });

  it("rises in the east and sets in the west", () => {
    // A sun that rises in the west is the classic sign-flip, and it is
    // invisible in a still screenshot.
    expect(sunAt(0).azimuthRad).toBeCloseTo(90 * DEG, 9);
    expect(sunAt(0.5).azimuthRad).toBeCloseTo(180 * DEG, 9);
    expect(sunAt(1).azimuthRad).toBeCloseTo(270 * DEG, 9);
  });

  it("sweeps azimuth monotonically, with no wrap discontinuity", () => {
    // A jump would make the shadows and the sky snap round mid-drag. The sweep
    // stays inside one turn precisely so no wrap is needed.
    let previous = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const { azimuthRad } = sunAt(Math.min(1, t));
      expect(azimuthRad).toBeGreaterThan(previous);
      previous = azimuthRad;
    }
  });

  it("sits on the horizon at both ends of the day", () => {
    expect(sunAt(0).elevationRad).toBeCloseTo(0, 9);
    expect(sunAt(1).elevationRad).toBeCloseTo(0, 9);
  });

  it("clamps out-of-range times rather than extrapolating", () => {
    // Defensive: the hotkey steps this value and an off-by-one would otherwise
    // put the sun underground, where the sky shader's output is undefined
    // rather than merely dark.
    expect(sunAt(-1)).toEqual(sunAt(0));
    expect(sunAt(2)).toEqual(sunAt(1));
    expect(sunAt(Number.NaN).elevationRad).toBeCloseTo(
      sunAt(DEFAULT_TIME_OF_DAY).elevationRad,
      9,
    );
  });

  it("defaults to a LOW sun, which is the whole look being adopted", () => {
    // DEC-R6-3 took the prototype's golden hour (~3.5°) as the default. A high
    // sun flattens relief — everything faces it equally — and grazing light is
    // what makes small height differences read, which is why every
    // cartographic hillshade uses one.
    const { elevationRad } = sunAt(DEFAULT_TIME_OF_DAY);
    expect(elevationRad).toBeGreaterThan(0);
    expect(elevationRad).toBeLessThan(10 * DEG);
  });
});

describe("the sun is not a headlight, at the default time", () => {
  it("stays well off the eye vector for the default camera", () => {
    // WHAT THIS PRESERVES FROM DEC-R4-6, and why it is now conditional. The
    // old sun could never be a headlight because it was pinned 45° off the
    // camera; a physical sun can be anywhere, and a sun directly behind the
    // viewer flattens the scene completely — N·L becomes maximal and nearly
    // constant for every surface facing you. That is the flash-photography
    // look, and it destroys exactly the relief §2's slope treatment exists to
    // reveal.
    //
    // It cannot be asserted at EVERY time of day any more — the user is allowed
    // to put the sun behind the camera deliberately. It is asserted at the
    // DEFAULT, which is what a first-time viewer sees.
    const camera = { x: 140, y: 110, z: 140 };
    const target = { x: 0, y: 10, z: 0 };
    const eye = {
      x: camera.x - target.x,
      y: camera.y - target.y,
      z: camera.z - target.z,
    };
    const eyeLength = length(eye);
    const sun = sunDirection(sunAt(DEFAULT_TIME_OF_DAY));
    const cos =
      (eye.x * sun.x + eye.y * sun.y + eye.z * sun.z) / (eyeLength * 1);
    expect(Math.acos(Math.max(-1, Math.min(1, cos)))).toBeGreaterThan(
      MIN_SUN_EYE_ANGLE_RAD,
    );
  });
});

describe("cameraAzimuth", () => {
  /**
   * WHY THESE TESTS MATTER, AND WHY THEY CHANGED. The module header states the
   * compass convention in capitals — azimuth is clockwise from **north**, and
   * north is **−z** — because `sun.ts` measured from `+z` and that had to be
   * corrected when the value became user-facing. `cameraAzimuth` came across
   * from `sun.ts` and kept the OLD convention, 180° out from `sunDirection`
   * beside it, and the previous test pinned the old convention rather than
   * catching it: its two cases were north/south (where the error is exactly
   * 180°, but the case chosen returned 0 either way) and east (where the ±90°
   * symmetry makes both conventions agree). Raised in review on #264.
   *
   * NORTH AND SOUTH ARE BOTH ASSERTED for that reason. A single on-axis case
   * cannot distinguish the two conventions; the pair is what makes the sign of
   * the z term observable.
   */
  it("measures clockwise from NORTH, the same convention as `sunDirection`", () => {
    const origin = { x: 0, y: 0, z: 0 };

    // Camera due north of the target: north is −z, so this is azimuth 0.
    expect(cameraAzimuth({ x: 0, y: 0, z: -10 }, origin)).toBe(0);
    // Due south — the case the old convention reported as 0.
    expect(cameraAzimuth({ x: 0, y: 0, z: 10 }, origin)).toBeCloseTo(
      Math.PI,
      9,
    );
    // Due east, and due west as its mirror. These agree under BOTH conventions,
    // which is exactly why they cannot be the only cases.
    expect(cameraAzimuth({ x: 10, y: 0, z: 0 }, origin)).toBeCloseTo(
      Math.PI / 2,
      9,
    );
    expect(cameraAzimuth({ x: -10, y: 0, z: 0 }, origin)).toBeCloseTo(
      -Math.PI / 2,
      9,
    );
  });

  it("agrees with `sunDirection`, which is the reason the convention matters", () => {
    // The round trip, and the assertion that would have caught the drift on its
    // own: feed an azimuth through `sunDirection` and read it back. A function
    // measuring from the opposite pole cannot pass this at any angle where the
    // two conventions differ.
    for (const azimuthRad of [0, Math.PI / 4, Math.PI / 2, 2.5, -1.2]) {
      const direction = sunDirection({ azimuthRad, elevationRad: 0.3 });
      expect(cameraAzimuth(direction, { x: 0, y: 0, z: 0 })).toBeCloseTo(
        azimuthRad,
        9,
      );
    }
  });

  it("returns 0 for a camera directly above its target", () => {
    // Degenerate rather than wrong: every azimuth looks the same from there.
    expect(cameraAzimuth({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(0);
  });
});
