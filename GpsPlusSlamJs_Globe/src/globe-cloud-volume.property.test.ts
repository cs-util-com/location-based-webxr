/**
 * Why this test matters: the cloud volume's noise must belong to the
 * GROUND, not to wherever the lab's world frame happens to be centred.
 * With a fixed offset every place put the same patch of noise under its
 * target, a clear one, so every link the owner zoomed into looked straight
 * down into the same hole (2026-10-06). The property: a fixed point on the
 * ground reads the same noise coordinate whichever target the frame is
 * centred on (the slab reads `xz / tile + offset`, the local frame x east,
 * z south). Checked exactly where the local frame is exact: targets on one
 * parallel (east-west) and on one meridian (north-south).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import {
  cloudVolumeDiscCentre,
  cloudVolumeNoiseOffset,
  cloudVolumeRecentreShift,
} from "./globe-cloud-volume.js";
import { worldFromEcefAt } from "./globe-frame.js";

const DEG = Math.PI / 180;

const R = 6_371_000;
const TILE_M = 24_000;
/**
 * The noise's period in tiles (the hex-tiled octave repeats at 13 tiles,
 * hex-tiling plan H1): the offset wraps there, not at one tile. These
 * properties measure modulo the period, so a wrap at one tile fails them.
 */
const PERIOD = 13;

/** The distance between two coordinates on a circle of PERIOD (wrapped). */
const wrapped = (a: number, b: number) => {
  const d = (((a - b) % PERIOD) + PERIOD) % PERIOD;
  return Math.min(d, PERIOD - d);
};

const latRad = fc.double({ min: -1.3, max: 1.3, noNaN: true });
const lonRad = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
const drift = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
/** A ground point within 30 km of the target (radians). */
const near = fc.double({ min: -0.0047, max: 0.0047, noNaN: true });

describe("cloudVolumeNoiseOffset (properties)", () => {
  it("is always in [0, the period) on both axes", () => {
    fc.assert(
      fc.property(latRad, lonRad, drift, (lat, lon, d) => {
        const [u, v] = cloudVolumeNoiseOffset(
          { latRad: lat, lonRad: lon, lonOffsetRad: d },
          TILE_M,
          PERIOD,
        );
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThan(PERIOD);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(PERIOD);
      }),
    );
  });

  it("gives a fixed ground point the same noise for two targets on its parallel", () => {
    fc.assert(
      fc.property(latRad, lonRad, near, near, drift, (lat, lon, d1, d2, d) => {
        const point = lon + d1;
        const read = (targetLon: number) => {
          const [u] = cloudVolumeNoiseOffset(
            { latRad: lat, lonRad: targetLon, lonOffsetRad: d },
            TILE_M,
            PERIOD,
          );
          const x = R * Math.cos(lat) * (point - targetLon);
          return x / TILE_M + u;
        };
        expect(wrapped(read(lon), read(lon + d2))).toBeLessThan(1e-6);
      }),
    );
  });

  it("gives a fixed ground point the same noise for two targets on its meridian", () => {
    fc.assert(
      fc.property(latRad, lonRad, near, near, (lat, lon, d1, d2) => {
        const point = lat + d1;
        const read = (targetLat: number) => {
          const [, v] = cloudVolumeNoiseOffset(
            { latRad: targetLat, lonRad: lon, lonOffsetRad: 0 },
            TILE_M,
            PERIOD,
          );
          const z = -R * (point - targetLat);
          return z / TILE_M + v;
        };
        expect(wrapped(read(lat), read(lat + d2))).toBeLessThan(1e-6);
      }),
    );
  });
});

describe("cloudVolumeDiscCentre (properties)", () => {
  // The disc never leaves the view's heading and never goes further ahead
  // than allowed: whatever the camera and its direction.
  it("lies on the view's heading, at most maxAheadM from the camera", () => {
    const coord = fc.double({ min: -100_000, max: 100_000, noNaN: true });
    const height = fc.double({ min: 0, max: 40_000, noNaN: true });
    const unit = fc.double({ min: -1, max: 1, noNaN: true });
    fc.assert(
      fc.property(
        coord,
        height,
        coord,
        unit,
        unit,
        unit,
        (x, y, z, dx, dy, dz) => {
          const len = Math.hypot(dx, dy, dz);
          fc.pre(len > 1e-3);
          const direction: [number, number, number] = [
            dx / len,
            dy / len,
            dz / len,
          ];
          const c = cloudVolumeDiscCentre({
            camera: [x, y, z],
            direction,
            deckY: 9_000,
            maxAheadM: 60_000,
          });
          const ox = c.x - x;
          const oz = c.z - z;
          expect(Math.hypot(ox, oz)).toBeLessThanOrEqual(60_000 + 1e-6);
          expect(Math.hypot(ox, oz)).toBeCloseTo(c.aheadM, 3);
          // Along the heading: no sideways part, never behind.
          expect(Math.abs(ox * direction[2] - oz * direction[0])).toBeLessThan(
            1e-3,
          );
          expect(ox * direction[0] + oz * direction[2]).toBeGreaterThanOrEqual(
            -1e-6,
          );
        },
      ),
    );
  });
});

// WHY (the owner, 2026-10-08, r805: "zooming out and back in, the clouds
// sometimes jump, as if a random seed were not persisted"): under the
// user's hand the lab recentres its frame once the camera's ground point
// drifts 20 km from the origin, in ANY direction. The offset alone is
// right only along a parallel or a meridian (above): a recentre that
// changes the latitude moved the whole noise by R dcos(lat) lon (a quarter
// tile near Bern). Carrying the shift across the recentre keeps a ground
// point's noise where it was, wherever the frame moves.
describe("a frame recentre in any direction (cloudVolumeRecentreShift)", () => {
  const ellipsoid = WGS84_ELLIPSOID;
  const xzIn = (
    target: { lat: number; lng: number },
    p: { lat: number; lng: number },
  ) => {
    const m = worldFromEcefAt(ellipsoid, target, new THREE.Matrix4());
    const v = ellipsoid
      .getCartographicToPosition(
        p.lat * DEG,
        p.lng * DEG,
        0,
        new THREE.Vector3(),
      )
      .applyMatrix4(m);
    return [v.x / TILE_M, v.z / TILE_M] as const;
  };
  const read = (
    target: { lat: number; lng: number },
    p: { lat: number; lng: number },
    driftRad: number,
    shift: readonly [number, number],
  ) => {
    const [x, z] = xzIn(target, p);
    const [u, v] = cloudVolumeNoiseOffset(
      {
        latRad: target.lat * DEG,
        lonRad: target.lng * DEG,
        lonOffsetRad: driftRad,
      },
      TILE_M,
      PERIOD,
    );
    return [x + u + shift[0], z + v + shift[1]] as const;
  };
  const latDeg = fc.double({ min: -70, max: 70, noNaN: true });
  const lngDeg = fc.double({ min: -179, max: 179, noNaN: true });
  /** Up to about 30 km, in degrees. */
  const step = fc.double({ min: -0.27, max: 0.27, noNaN: true });

  it("keeps a ground point's noise across the recentre", () => {
    fc.assert(
      fc.property(
        latDeg,
        lngDeg,
        step,
        step,
        step,
        step,
        drift,
        (lat, lng, a, b, c, d, dr) => {
          const from = { lat, lng };
          const to = { lat: lat + a, lng: lng + b };
          const point = { lat: to.lat + c / 2, lng: to.lng + d / 2 };
          const shift = cloudVolumeRecentreShift(
            ellipsoid,
            from,
            to,
            dr,
            TILE_M,
            PERIOD,
          );
          const before = read(from, point, dr, [0, 0]);
          const after = read(to, point, dr, shift);
          expect(wrapped(before[0], after[0])).toBeLessThan(0.003);
          expect(wrapped(before[1], after[1])).toBeLessThan(0.003);
        },
      ),
    );
  });

  // The bug, measured: without the shift a 20 km diagonal recentre near
  // Bern moved the noise under a ground point by a large share of a tile.
  it("moved the noise without it (the owner's jump)", () => {
    const from = { lat: 46.95, lng: 7.45 };
    const to = { lat: 47.08, lng: 7.63 };
    const point = { lat: 47.05, lng: 7.6 };
    const before = read(from, point, 0, [0, 0]);
    const after = read(to, point, 0, [0, 0]);
    expect(wrapped(before[0], after[0])).toBeGreaterThan(0.05);
  });
});
