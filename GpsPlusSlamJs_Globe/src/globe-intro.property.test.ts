/**
 * Properties of the fly-in (round-5 plan 2026-10-01-0945 §3.1, §5).
 *
 * Why this test matters: the intro meets every place and every time of day
 * (the sun anywhere), so its invariants are checked over random targets,
 * suns, caps, moments and variants rather than at a few hand-picked ones:
 * the start is exactly min(cap, the sun's angle) from the target and on
 * the great circle towards the sun, and on the way the camera never leaves
 * the span between its start and its end.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  INTRO_VARIANTS,
  flyInStart,
  introCameraPose,
  introStartDirection,
  spinDirection,
  type Vec3,
} from "./globe-intro.js";
import { unitShare } from "./test-utils/arbitraries.js";

const DEG = Math.PI / 180;
const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const angleDeg = (a: Vec3, b: Vec3): number =>
  Math.atan2(Math.hypot(...cross(a, b)), dot(a, b)) / DEG;

/** A unit vector from a latitude and longitude, away from the poles' edge cases. */
const direction = fc
  .record({
    lat: fc.double({ min: -89, max: 89, noNaN: true }),
    lng: fc.double({ min: -180, max: 180, noNaN: true }),
  })
  .map(({ lat, lng }): Vec3 => [
    Math.cos(lat * DEG) * Math.cos(lng * DEG),
    Math.cos(lat * DEG) * Math.sin(lng * DEG),
    Math.sin(lat * DEG),
  ]);

describe("introStartDirection, over any target, sun and cap", () => {
  it("is min(cap, the sun's angle) from the target, towards the sun", () => {
    fc.assert(
      fc.property(
        direction,
        direction,
        fc.double({ min: 0, max: 180, noNaN: true }),
        (target, sun, cap) => {
          const between = angleDeg(target, sun);
          fc.pre(between > 1e-3 && between < 179.9);
          const start = introStartDirection(target, sun, cap);
          const want = Math.min(cap, between);
          expect(Math.abs(angleDeg(start, target) - want)).toBeLessThan(1e-6);
          // On the target-sun great circle: no component off its plane.
          const normal = cross(target, sun);
          const n = Math.hypot(...normal);
          expect(Math.abs(dot(start, normal)) / n).toBeLessThan(1e-9);
          // Towards the sun, not away from it.
          expect(angleDeg(start, sun)).toBeLessThanOrEqual(between + 1e-6);
        },
      ),
    );
  });
});

describe("introCameraPose, at any moment of any variant", () => {
  it("stays between its start and its end", () => {
    fc.assert(
      fc.property(
        direction,
        direction,
        fc.constantFrom(...INTRO_VARIANTS),
        unitShare(fc),
        fc.double({ min: 7000, max: 60_000, noNaN: true }),
        fc.double({ min: 7000, max: 60_000, noNaN: true }),
        (start, target, variant, t, a, b) => {
          const startKm = Math.max(a, b);
          const endKm = Math.min(a, b);
          const p = introCameraPose(t, {
            variant,
            start,
            target,
            startKm,
            endKm,
            endFovDeg: 50,
          });
          expect(Math.hypot(...p.direction)).toBeCloseTo(1, 9);
          expect(p.distanceKm).toBeGreaterThanOrEqual(endKm * (1 - 1e-12));
          expect(p.distanceKm).toBeLessThanOrEqual(startKm * (1 + 1e-12));
          expect(p.fovDeg).toBeGreaterThanOrEqual(50 - 1e-9);
          expect(p.fovDeg).toBeLessThanOrEqual(80 + 1e-9);
        },
      ),
    );
  });
});

// Why (review 2026-10-01-2124 Major 2): whatever the time of day and
// wherever the position arrives from, the fly-in starts where the spin
// was and settles within the cap of the target, never farther.
describe("flyInStart, over any spin, target, sun and cap", () => {
  it("begins at the spin and settles at most the cap from the target", () => {
    fc.assert(
      fc.property(
        direction,
        direction,
        fc.double({ min: 0, max: 60_000, noNaN: true }),
        fc.double({ min: 0, max: 180, noNaN: true }),
        (target, sun, spinMs, cap) => {
          const between = angleDeg(target, sun);
          fc.pre(between > 1e-3 && between < 179.9);
          const spin = spinDirection(sun, spinMs, -3);
          const at = (ms: number) =>
            flyInStart({
              spin,
              target,
              sun,
              capDeg: cap,
              sinceArrivalMs: ms,
              blendMs: 1500,
            });
          expect(angleDeg(at(0), spin)).toBeLessThan(1e-6);
          expect(angleDeg(at(1500), target)).toBeLessThanOrEqual(
            Math.min(cap, between) + 1e-6,
          );
        },
      ),
    );
  });
});
