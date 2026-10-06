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

import {
  cloudVolumeDiscCentre,
  cloudVolumeNoiseOffset,
} from "./globe-cloud-volume.js";

const R = 6_371_000;
const TILE_M = 24_000;

/** The distance between two coordinates on the unit circle (wrapped). */
const wrapped = (a: number, b: number) => {
  const d = (((a - b) % 1) + 1) % 1;
  return Math.min(d, 1 - d);
};

const latRad = fc.double({ min: -1.3, max: 1.3, noNaN: true });
const lonRad = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
const drift = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
/** A ground point within 30 km of the target (radians). */
const near = fc.double({ min: -0.0047, max: 0.0047, noNaN: true });

describe("cloudVolumeNoiseOffset (properties)", () => {
  it("is always in [0, 1) on both axes", () => {
    fc.assert(
      fc.property(latRad, lonRad, drift, (lat, lon, d) => {
        const [u, v] = cloudVolumeNoiseOffset(
          { latRad: lat, lonRad: lon, lonOffsetRad: d },
          TILE_M,
        );
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThan(1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
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
