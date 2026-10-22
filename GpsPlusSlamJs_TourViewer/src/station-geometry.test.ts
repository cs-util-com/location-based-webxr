/**
 * Why these tests matter: the station geometry is what every editing
 * gesture of the 3D editor reduces to - a radius the creator types, a copy
 * set beside its original, an item put on (or kept above) the ground, a
 * station moved with its items. A wrong bound saves a tour the format
 * refuses; a wrong height rule sinks or floats an item by the difference
 * of two ground heights; a rigid move that is not rigid nudges every item
 * a little on every move. The parameters each verdict rests on are tested
 * at both edges and just outside them.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import {
  itemGeoPose,
  localPoseOf,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";
import "./test-support/v3-tour.js";
import { horizontalM } from "./move-with-code.js";
import {
  altKeepingHeight,
  duplicateItemGeo,
  duplicateStationGeo,
  isStationRadius,
  ITEM_DUPLICATE_OFFSET_M,
  preloadRadiusM,
  rigidlyMoved,
  STATION_RADIUS_MAX_M,
  STATION_RADIUS_MIN_M,
} from "./station-geometry.js";

const AT: QrGeoPose = {
  lat: 48.137,
  lon: 11.575,
  alt: 566.5,
  rotation: [0, 0, 0, 1],
};

/** The rotation of `deg` degrees about Up (a station turned against
 *  north). */
function turned(deg: number): [number, number, number, number] {
  const half = (-deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

describe("station radius bounds", () => {
  it("accepts 2 m to 300 m inclusive and nothing outside, nor a non-number", () => {
    expect(STATION_RADIUS_MIN_M).toBe(2);
    expect(STATION_RADIUS_MAX_M).toBe(300);
    for (const ok of [2, 2.0001, 25, 299.999, 300]) {
      expect(isStationRadius(ok)).toBe(true);
    }
    for (const bad of [
      1.999,
      300.001,
      0,
      -5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(isStationRadius(bad)).toBe(false);
    }
  });

  it("preloads at twice the found radius, at both edges", () => {
    expect(preloadRadiusM(2)).toBe(4);
    expect(preloadRadiusM(300)).toBe(600);
    expect(preloadRadiusM(25)).toBe(50);
  });
});

describe("where a copy stands", () => {
  it("a station's copy stands twice its found radius plus 5 m east, at its height, turned like it", () => {
    for (const found of [2, 25, 300]) {
      const frame = {
        geo: { ...AT, rotation: turned(30) },
        foundRadiusM: found,
      };
      const copy = duplicateStationGeo(frame);
      expect(horizontalM(frame.geo, copy)).toBeCloseTo(2 * found + 5, 2);
      // East: the same latitude within a millimetre, a larger longitude.
      expect(Math.abs(copy.lat - AT.lat) * 111_320).toBeLessThan(0.001);
      expect(copy.lon).toBeGreaterThan(AT.lon);
      expect(copy.alt).toBe(AT.alt);
      expect(copy.rotation).toEqual(frame.geo.rotation);
    }
  });

  it("an item's copy stands 1.5 m east of it, at its height and facing", () => {
    expect(ITEM_DUPLICATE_OFFSET_M).toBe(1.5);
    const geo: QrGeoPose = { ...AT, headingDeg: 70 };
    const copy = duplicateItemGeo(geo);
    expect(horizontalM(geo, copy)).toBeCloseTo(1.5, 3);
    expect(copy.lon).toBeGreaterThan(geo.lon);
    expect(copy.alt).toBe(geo.alt);
    expect(copy.headingDeg).toBe(70);
  });
});

describe("heights (the file holds ellipsoidal altitudes)", () => {
  it("an item moved over other ground keeps its height above the ground", () => {
    expect(
      altKeepingHeight({ alt: 571.5, groundBefore: 566.5, groundAfter: 570 }),
    ).toBeCloseTo(575, 9);
  });

  it("keeps the height above the ground over random ground heights (property)", () => {
    // Ground from a sea-level coast to an alpine pass, items up to 50 m
    // above or 5 m below it (a basement); the height above the ground is
    // what a creator set, so it must survive any change of the ground.
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 3000, noNaN: true }),
        fc.double({ min: -50, max: 3000, noNaN: true }),
        fc.double({ min: -5, max: 50, noNaN: true }),
        (groundBefore, groundAfter, above) => {
          const alt = altKeepingHeight({
            alt: groundBefore + above,
            groundBefore,
            groundAfter,
          });
          expect(Math.abs(alt - groundAfter - above)).toBeLessThan(1e-6);
        },
      ),
    );
  });
});

describe("a station moves rigidly", () => {
  it("keeps every item's local pose within 1 mm, and moving back returns it within 1 mm (property)", () => {
    // Stations up to 1 km apart and turned any way, items up to 300 m
    // (the largest found radius) from their station and 20 m above or
    // below it.
    const geoNear = (around: QrGeoPose, reachM: number) =>
      fc
        .record({
          n: fc.double({ min: -reachM, max: reachM, noNaN: true }),
          e: fc.double({ min: -reachM, max: reachM, noNaN: true }),
          u: fc.double({ min: -20, max: 20, noNaN: true }),
          deg: fc.double({ min: -180, max: 180, noNaN: true }),
        })
        .map(({ n, e, u, deg }): QrGeoPose => ({
          lat: around.lat + n / 111_320,
          lon: around.lon + e / 74_500,
          alt: around.alt + u,
          rotation: turned(deg),
        }));
    fc.assert(
      fc.property(
        geoNear(AT, 1000),
        geoNear(AT, 1000),
        geoNear(AT, 300),
        (from, to, item) => {
          const moved = rigidlyMoved(item, from, to);
          const before = localPoseOf(item, from).position;
          const after = localPoseOf(moved, to).position;
          for (let i = 0; i < 3; i += 1) {
            expect(Math.abs((after[i] ?? 0) - (before[i] ?? 0))).toBeLessThan(
              0.001,
            );
          }
          const back = rigidlyMoved(moved, to, from);
          expect(horizontalM(back, item)).toBeLessThan(0.001);
          expect(Math.abs(back.alt - item.alt)).toBeLessThan(0.001);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("local to geo to local is the identity within 1 mm (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -300, max: 300, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -300, max: 300, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (n, u, e, deg) => {
          const station = { ...AT, rotation: turned(deg) };
          const pose = {
            position: [n, u, e] as [number, number, number],
            rotation: [0, 0, 0, 1] as [number, number, number, number],
          };
          const back = localPoseOf(itemGeoPose(pose, station), station);
          for (let i = 0; i < 3; i += 1) {
            expect(
              Math.abs((back.position[i] ?? 0) - (pose.position[i] ?? 0)),
            ).toBeLessThan(0.001);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
