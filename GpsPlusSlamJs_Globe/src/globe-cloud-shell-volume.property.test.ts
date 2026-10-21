/**
 * Why this test matters: the spherical cloud volume (round-4 plan
 * 2026-10-11-0122, R4d) reads the cloud map and the live noise at points of
 * a shell seen up to 2,900 km away (the horizon from 700 km), and below the
 * slab's ceiling it is MIXED with the slab, which reads both in a flat
 * frame around the target. Two readers of one field: if they disagreed
 * where they meet, the hand-over would show the clouds sliding or a second
 * pattern dissolving in. What these properties hold:
 *
 * - **The map at the true latitude and longitude**: the twin's geodetic
 *   latitude and longitude of a shell point are the ellipsoid's own (the
 *   surface reads the map at the geodetic normal), and its uv is the
 *   globe's mapping with the drift taken off.
 * - **The noise where the slab reads it**: near the frame's origin the
 *   chart IS the frame's local x (east) and z (south) of the ground point,
 *   so the shell and the slab read the same noise; further out it keeps the
 *   ground distance (azimuthal equidistant, round-3 plan §10 item 7).
 * - **Across a recentre** (the frame moves under the camera below 150 km),
 *   a ground point keeps its noise-plane position when the live anchor is
 *   carried (`cloudVolumeAnchorRecentre`): within metres near the camera,
 *   and the jump far out bounded and stated.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import {
  type CloudNoiseAnchorKm,
  cloudVolumeAnchorRecentre,
} from "./globe-cloud-volume.js";
import { worldFromEcefAt } from "./globe-frame.js";
import {
  cloudShellColumn,
  cloudShellFrame,
} from "./globe-cloud-shell-volume.js";

const DEG = Math.PI / 180;
/** The atmosphere model's ground radius (km): the lab's model sphere. */
const GROUND_KM = 6_360;
const RADII = [
  WGS84_ELLIPSOID.radius.x,
  WGS84_ELLIPSOID.radius.y,
  WGS84_ELLIPSOID.radius.z,
] as const;

/** A point at `heightM` over the ellipsoid, in the model frame (km). */
function modelPoint(latDeg: number, lngDeg: number, heightM: number) {
  const ecef = WGS84_ELLIPSOID.getCartographicToPosition(
    latDeg * DEG,
    lngDeg * DEG,
    heightM,
    new THREE.Vector3(),
  );
  return [
    (ecef.x * GROUND_KM) / RADII[0],
    (ecef.y * GROUND_KM) / RADII[1],
    (ecef.z * GROUND_KM) / RADII[2],
  ] as const;
}

/** The great-circle distance (km) on a sphere of the mean radius. */
function haversineKm(a: [number, number], b: [number, number]): number {
  const [la1, lo1] = [a[0] * DEG, a[1] * DEG];
  const [la2, lo2] = [b[0] * DEG, b[1] * DEG];
  const h =
    Math.sin((la2 - la1) / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * 6_371.0088 * Math.asin(Math.sqrt(h));
}

const lat = fc.double({ min: -75, max: 75, noNaN: true });
const lng = fc.double({ min: -180, max: 180, noNaN: true });

describe("cloudShellColumn: the map", () => {
  it("reads the map at the point's geodetic latitude and longitude, with the drift", () => {
    fc.assert(
      fc.property(
        lat,
        lng,
        fc.double({ min: 0, max: 12_000, noNaN: true }),
        fc.double({ min: -7, max: 7, noNaN: true }),
        (la, lo, h, drift) => {
          const frame = cloudShellFrame(
            WGS84_ELLIPSOID,
            { lat: 47, lng: 8 },
            GROUND_KM,
          );
          const c = cloudShellColumn(modelPoint(la, lo, h), frame, drift);
          // 3 km of height turns the normal by about 3e-6 rad (the
          // ellipsoid's flattening times h / a); bound 1e-5 rad (6 cm).
          expect(Math.abs(c.latRad - la * DEG)).toBeLessThan(1e-5);
          const dLon = Math.atan2(
            Math.sin(c.lonRad - lo * DEG),
            Math.cos(c.lonRad - lo * DEG),
          );
          expect(Math.abs(dLon)).toBeLessThan(1e-9);
          expect(c.heightKm).toBeCloseTo(h / 1000, 1);
          const u = (c.lonRad - drift) / (2 * Math.PI) + 0.5;
          expect(c.uv[0]).toBeCloseTo(u, 12);
          expect(c.uv[1]).toBeCloseTo(c.latRad / Math.PI + 0.5, 12);
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe("cloudShellColumn: the chart", () => {
  it("is the frame's local x and z of the ground point near the origin", () => {
    const local = new THREE.Matrix4();
    fc.assert(
      fc.property(
        lat,
        lng,
        fc.double({ min: -0.45, max: 0.45, noNaN: true }),
        fc.double({ min: -0.45, max: 0.45, noNaN: true }),
        fc.double({ min: 0, max: 8_000, noNaN: true }),
        (la, lo, dLat, dLng, h) => {
          const target = { lat: la, lng: lo };
          const frame = cloudShellFrame(WGS84_ELLIPSOID, target, GROUND_KM);
          const c = cloudShellColumn(
            modelPoint(la + dLat, lo + dLng, h),
            frame,
            0,
          );
          worldFromEcefAt(WGS84_ELLIPSOID, target, local);
          const g = WGS84_ELLIPSOID.getCartographicToPosition(
            (la + dLat) * DEG,
            (lo + dLng) * DEG,
            0,
            new THREE.Vector3(),
          ).applyMatrix4(local);
          // Within about 50 km: the arc against the chord (under 0.5 m),
          // the radial foot against the normal's (h x 0.0034 rad, 27 m at
          // 8 km over the steepest deflection), so 30 m.
          expect(Math.abs(c.chartKm[0] - g.x / 1000)).toBeLessThan(0.03);
          expect(Math.abs(c.chartKm[1] - g.z / 1000)).toBeLessThan(0.03);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("keeps the ground distance far out (azimuthal equidistant)", () => {
    fc.assert(
      fc.property(
        lat,
        lng,
        fc.double({ min: -25, max: 25, noNaN: true }),
        fc.double({ min: -25, max: 25, noNaN: true }),
        (la, lo, dLat, dLng) => {
          const to: [number, number] = [
            Math.max(-80, Math.min(80, la + dLat)),
            lo + dLng,
          ];
          const frame = cloudShellFrame(
            WGS84_ELLIPSOID,
            { lat: la, lng: lo },
            GROUND_KM,
          );
          const c = cloudShellColumn(modelPoint(to[0], to[1], 0), frame, 0);
          const d = haversineKm([la, lo], to);
          // The chord taken back to the arc on the Gaussian sphere at the
          // origin's latitude, against the mean sphere: the radii differ by
          // at most 0.5 %.
          expect(Math.abs(Math.hypot(...c.chartKm) - d)).toBeLessThan(
            0.006 * d + 0.05,
          );
        },
      ),
      { numRuns: 400 },
    );
  });
});

/** A ground point's noise-plane position (km) for an anchor and a frame. */
function planeKm(
  anchor: CloudNoiseAnchorKm,
  frame: ReturnType<typeof cloudShellFrame>,
  point: readonly [number, number, number],
): [number, number] {
  const [x, z] = cloudShellColumn(point, frame, 0).chartKm;
  const c = Math.cos(anchor.rotationRad);
  const s = Math.sin(anchor.rotationRad);
  return [
    anchor.originKm[0] + c * x - s * z,
    anchor.originKm[1] + s * x + c * z,
  ];
}

describe("cloudShellColumn: across a recentre", () => {
  // The slab's disc reaches 140 km; the carry was built to keep those
  // points (a 20 km hop and the arc's hop leave metres there).
  it("keeps a ground point's noise near the camera within metres", () => {
    fc.assert(
      fc.property(
        lat,
        lng,
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 0, max: 140, noNaN: true }),
        (la, lo, hopBearing, pointBearing, pointKm) => {
          const from = { lat: la, lng: lo };
          const hopDeg = 20 / 111.2;
          const to = {
            lat: la + hopDeg * Math.cos(hopBearing),
            lng: lo + (hopDeg * Math.sin(hopBearing)) / Math.cos(la * DEG),
          };
          const a: CloudNoiseAnchorKm = {
            originKm: [1234.5, -5678.9],
            rotationRad: 0.3,
          };
          const b = cloudVolumeAnchorRecentre(WGS84_ELLIPSOID, a, from, to);
          const pDeg = pointKm / 111.2;
          const p = modelPoint(
            to.lat + pDeg * Math.cos(pointBearing),
            to.lng + (pDeg * Math.sin(pointBearing)) / Math.cos(to.lat * DEG),
            0,
          );
          const pa = planeKm(
            a,
            cloudShellFrame(WGS84_ELLIPSOID, from, GROUND_KM),
            p,
          );
          const pb = planeKm(
            b,
            cloudShellFrame(WGS84_ELLIPSOID, to, GROUND_KM),
            p,
          );
          expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1])).toBeLessThan(0.02);
        },
      ),
      { numRuns: 300 },
    );
  });

  // Far out the chart around a new origin is not the old one moved: the
  // azimuthal chart is not an isometry. Measured: the jump grows about as
  // hop x (d / R)^2; the bound is that law with room, and it stays under a
  // pixel's footprint at those distances from 150 km (about 1 km at
  // 1,000 km along a grazing ray).
  it("bounds the jump far out, about hop x (d / R)^2", () => {
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const la = -60 + ((i * 37) % 120);
      const lo = -170 + ((i * 53) % 340);
      const from = { lat: la, lng: lo };
      const hopBearing = (i * 0.731) % (2 * Math.PI);
      const hopDeg = 20 / 111.2;
      const to = {
        lat: la + hopDeg * Math.cos(hopBearing),
        lng: lo + (hopDeg * Math.sin(hopBearing)) / Math.cos(la * DEG),
      };
      const a: CloudNoiseAnchorKm = { originKm: [0, 0], rotationRad: 0 };
      const b = cloudVolumeAnchorRecentre(WGS84_ELLIPSOID, a, from, to);
      for (const dKm of [500, 1_000, 1_500]) {
        const bearing = (i * 1.37) % (2 * Math.PI);
        const pDeg = dKm / 111.2;
        const pLat = to.lat + pDeg * Math.cos(bearing);
        if (Math.abs(pLat) > 80) continue;
        const p = modelPoint(
          pLat,
          to.lng + (pDeg * Math.sin(bearing)) / Math.cos(to.lat * DEG),
          0,
        );
        const pa = planeKm(
          a,
          cloudShellFrame(WGS84_ELLIPSOID, from, GROUND_KM),
          p,
        );
        const pb = planeKm(
          b,
          cloudShellFrame(WGS84_ELLIPSOID, to, GROUND_KM),
          p,
        );
        const jump = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
        const law = 20 * (dKm / 6_371) ** 2;
        worst = Math.max(worst, jump / law);
      }
    }
    expect(worst).toBeLessThan(2);
  });
});

describe("cloudShellFrame", () => {
  it("refuses a target off the globe and a model radius that is not positive", () => {
    expect(() =>
      cloudShellFrame(WGS84_ELLIPSOID, { lat: 95, lng: 0 }, GROUND_KM),
    ).toThrow(RangeError);
    expect(() =>
      cloudShellFrame(WGS84_ELLIPSOID, { lat: 0, lng: 0 }, 0),
    ).toThrow(RangeError);
    const frame = cloudShellFrame(
      WGS84_ELLIPSOID,
      { lat: 0, lng: 0 },
      GROUND_KM,
    );
    expect(() => cloudShellColumn([Number.NaN, 0, 0], frame, 0)).toThrow(
      RangeError,
    );
  });
});
