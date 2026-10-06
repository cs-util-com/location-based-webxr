/**
 * Why these tests matter (UI round 1, U3; owner decision 2026-10-06: an
 * improved code position takes the pins and photos within about 40 m with
 * it): a scanning visitor's phone lines the tour up so the code's SAVED
 * position sits on the real poster, and shows each object at its saved
 * position relative to that. Improving the code's position without moving
 * those objects the same way would shift every one of them against the
 * poster - by about 4 m at 6 m for the field recording's 41 degrees. The
 * transform must be rigid: each object keeps exactly its place relative to
 * the code.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import { createTourViewerStore } from "./tour-viewer-session";
import { moveWithCode, withinCodeReach } from "./move-with-code";

// The geodesy is licence-gated; building a store activates it, as the page
// does at boot.
createTourViewerStore();

type Pose = QrGeoPose;

const yaw = (deg: number): [number, number, number, number] => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
};
const metres = (a: Pose, b: Pose) => {
  const r = calcRelativeCoordsInMeters(a, b, b.alt, a.alt);
  return Math.hypot(r[0], r[1], r[2]);
};

const code: Pose = { lat: 48.1374, lon: 11.5755, alt: 520, rotation: yaw(0) };

describe("moveWithCode", () => {
  it("an object at the code moves to the code's new spot", () => {
    const moved: Pose = {
      lat: 48.13742,
      lon: 11.57553,
      alt: 521,
      rotation: yaw(41),
    };
    const out = moveWithCode({ ...code }, code, moved);
    expect(metres(out, moved)).toBeLessThan(0.001);
  });

  it("turns an object 6 m in front of the code with the code (41 degrees, the field case)", () => {
    const pin: Pose = {
      lat: code.lat + 6 / 111_320,
      lon: code.lon,
      alt: 520,
      headingDeg: 0,
    };
    const turned: Pose = { ...code, rotation: yaw(41) };
    const out = moveWithCode(pin, code, turned);
    // Same distance to the code (the fixture's 6 m is ~5.98 m on the
    // ellipsoid), now about 4.2 m from where it was: the chord of 41 degrees.
    const d = metres(pin, code);
    expect(metres(out, turned)).toBeCloseTo(d, 3);
    expect(metres(out, pin)).toBeCloseTo(
      2 * d * Math.sin((41 / 2) * (Math.PI / 180)),
      2,
    );
  });

  it("turns a heading-only pose's heading with the code (the -h about Up convention)", () => {
    // Why: a photo minted before rotations existed carries only a heading;
    // a code turned 41 degrees anticlockwise (seen from above) turns its
    // heading from 10 to 329.
    const photo: Pose = {
      lat: code.lat,
      lon: code.lon,
      alt: code.alt,
      headingDeg: 10,
    };
    const out = moveWithCode(photo, code, { ...code, rotation: yaw(41) });
    expect(out.rotation).toBeUndefined();
    expect(out.headingDeg).toBeCloseTo(329, 6);
  });

  it("keeps every object's distance to the code, and undoes itself (property)", () => {
    const pose = fc.record({
      north: fc.double({ min: -40, max: 40, noNaN: true }),
      east: fc.double({ min: -40, max: 40, noNaN: true }),
      up: fc.double({ min: -3, max: 3, noNaN: true }),
      deg: fc.double({ min: -180, max: 180, noNaN: true }),
    });
    fc.assert(
      fc.property(pose, pose, (obj, shift) => {
        const object: Pose = {
          lat: code.lat + obj.north / 111_320,
          lon:
            code.lon +
            obj.east / (111_320 * Math.cos((code.lat * Math.PI) / 180)),
          alt: code.alt + obj.up,
          rotation: yaw(obj.deg),
        };
        const moved: Pose = {
          lat: code.lat + shift.north / 1_000_000,
          lon: code.lon + shift.east / 1_000_000,
          alt: code.alt + shift.up,
          rotation: yaw(shift.deg),
        };
        const out = moveWithCode(object, code, moved);
        expect(metres(out, moved)).toBeCloseTo(metres(object, code), 2);
        const back = moveWithCode(out, moved, code);
        expect(metres(back, object)).toBeLessThan(0.01);
      }),
      { numRuns: 200 },
    );
  });
});

describe("withinCodeReach", () => {
  it("is the objects within 40 m of the code (the owner's 'about 40 m')", () => {
    const at = (m: number): Pose => ({ ...code, lat: code.lat + m / 111_320 });
    expect(withinCodeReach(at(39), code)).toBe(true);
    expect(withinCodeReach(at(41), code)).toBe(false);
  });
});
