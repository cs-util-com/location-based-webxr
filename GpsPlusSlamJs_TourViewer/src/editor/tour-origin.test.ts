/**
 * Why these tests matter: the 3D view's frame and its first orbit centre
 * on the tour (`tourCentre`), and the inspector says where a station
 * stands as metres east and north of that same centre (`eastNorthOf`).
 * The two must agree with what the 3D view draws, or a creator reads one
 * number and sees the station somewhere else; so the metres are checked
 * against the 3D view's own frame (the globe's `worldFromEcefAt`) on an
 * ellipsoid written out by its textbook formula.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { worldFromEcefAt } from "gps-plus-slam-globe/editor";

import { eastNorthOf, tourCentre } from "./tour-origin.js";

describe("tourCentre", () => {
  const geo = (lat: number, lon: number, alt: number) => ({
    geo: { lat, lon, alt },
  });

  // Why: the 3D view's frame and its first orbit centre on the tour: the
  // mean of its stations' positions and heights; a tour without stations
  // centres on its codes; one with neither has nothing to show.
  it("is the mean of the stations, else of the codes, else none", () => {
    const centre = tourCentre([geo(48, 11, 500), geo(48.002, 11.004, 520)], []);
    expect(centre?.lat).toBeCloseTo(48.001, 12);
    expect(centre?.lng).toBeCloseTo(11.002, 12);
    expect(centre?.altM).toBeCloseTo(510, 9);
    expect(tourCentre([], [geo(47, 8, 400).geo])).toEqual({
      lat: 47,
      lng: 8,
      altM: 400,
    });
    expect(tourCentre([], [])).toBeNull();
  });

  // Why: a point the file cannot place (NaN) must not drag the frame to
  // the middle of nowhere; it is left out of the mean.
  it("leaves out points that cannot be placed", () => {
    expect(
      tourCentre([geo(48, 11, 500), geo(Number.NaN, 11, 500)], []),
    ).toEqual({ lat: 48, lng: 11, altM: 500 });
    expect(tourCentre([geo(Number.NaN, 0, 0)], [])).toBeNull();
  });
});

/** WGS84 (a, f), geodetic to ECEF by the textbook formula. */
const A = 6_378_137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
function ecefOf(latRad: number, lonRad: number, h: number, out: THREE.Vector3) {
  const n = A / Math.sqrt(1 - E2 * Math.sin(latRad) ** 2);
  return out.set(
    (n + h) * Math.cos(latRad) * Math.cos(lonRad),
    (n + h) * Math.cos(latRad) * Math.sin(lonRad),
    (n * (1 - E2) + h) * Math.sin(latRad),
  );
}
type GlobeEllipsoid = Parameters<typeof worldFromEcefAt>[0];
const WGS84 = {
  getCartographicToPosition: ecefOf,
} as unknown as GlobeEllipsoid;
const DEG = Math.PI / 180;

/** Where the 3D view's frame centred on `origin` puts `point` (x east,
 *  z south, on the ellipsoid). */
function drawnAt(
  point: { lat: number; lon: number },
  origin: { lat: number; lng: number },
): { eastM: number; northM: number } {
  const world = worldFromEcefAt(WGS84, origin, new THREE.Matrix4());
  const p = ecefOf(point.lat * DEG, point.lon * DEG, 0, new THREE.Vector3());
  p.applyMatrix4(world);
  return { eastM: p.x, northM: -p.z };
}

describe("eastNorthOf", () => {
  // Why: the inspector's metres are where the 3D view draws the point, to
  // the millimetre, anywhere a tour reaches (here up to about 1.2 km), at
  // a city's latitude, near the equator and far north.
  it("is where the 3D view's frame draws the point", () => {
    for (const origin of [
      { lat: 48.137393, lng: 11.575493 },
      { lat: -0.5, lng: -78.3 },
      { lat: 69.65, lng: 18.96 },
    ]) {
      for (const [dLat, dLon] of [
        [0, 0],
        [0.004, 0.006],
        [-0.009, 0.002],
        [0.001, -0.011],
      ] as const) {
        const point = { lat: origin.lat + dLat, lon: origin.lng + dLon };
        const got = eastNorthOf(point, origin);
        const want = drawnAt(point, origin);
        expect(got?.eastM).toBeCloseTo(want.eastM, 3);
        expect(got?.northM).toBeCloseTo(want.northM, 3);
      }
    }
  });

  // Why: a point or an origin the file cannot place has no metres; the
  // inspector says so rather than showing NaN.
  it("is null for a point or an origin that is not a place", () => {
    const origin = { lat: 48, lng: 11 };
    expect(eastNorthOf({ lat: Number.NaN, lon: 11 }, origin)).toBeNull();
    expect(eastNorthOf({ lat: 48, lon: 11 }, { lat: 91, lng: 11 })).toBeNull();
    expect(
      eastNorthOf({ lat: 48, lon: 11 }, { lat: 48, lng: Infinity }),
    ).toBeNull();
  });
});
