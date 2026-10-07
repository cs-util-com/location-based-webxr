/**
 * Why this test matters: a replan can come at any moment of any flight
 * (continuous-flight plan 2026-10-07-0941, CF2), so the examples in
 * flight-replan.test.ts are backed by properties over random flights,
 * replan times, new places nearby and new landings:
 * - the replanned camera starts exactly where the camera was;
 * - its velocity has no jump across the replan (central differences);
 * - it lands exactly at the new place and altitude;
 * - it never goes below the lowest of the start and the two landings.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { orbitPose } from "./globe-camera.js";
import { obliqueCamera } from "./globe-dive.js";
import {
  flightCameraAt,
  flightFrameAt,
  retargetFlight,
  startFlight,
} from "./flight-replan.js";

const replan = fc.record({
  from: fc.record({
    lat: fc.double({ min: -70, max: 70, noNaN: true }),
    lng: fc.double({ min: -180, max: 180, noNaN: true }),
  }),
  to: fc.record({
    lat: fc.double({ min: -70, max: 70, noNaN: true }),
    lng: fc.double({ min: -180, max: 180, noNaN: true }),
  }),
  startKm: fc.double({ min: 3_000, max: 40_000, noNaN: true }),
  landingM: fc.double({ min: 1_000, max: 20_000, noNaN: true }),
  newLandingM: fc.double({ min: 1_000, max: 20_000, noNaN: true }),
  /** The new place, this many degrees from the old target (0: a new landing only). */
  shiftDeg: fc.oneof(
    fc.constant(0),
    fc.double({ min: 0.01, max: 2, noNaN: true }),
  ),
  /** When, as a share of the first flight. */
  share: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
});

type Replan = typeof replan extends fc.Arbitrary<infer T> ? T : never;

function setUp(r: Replan) {
  const pose = orbitPose(WGS84_ELLIPSOID, r.from);
  const cam = obliqueCamera(WGS84_ELLIPSOID, pose, r.startKm * 1_000, 90);
  const first = startFlight(
    WGS84_ELLIPSOID,
    { pose, distanceM: cam.position.length(), quaternion: cam.quaternion },
    orbitPose(WGS84_ELLIPSOID, r.to),
    { landingM: r.landingM, durationMs: 15_000 },
    0,
  );
  const atMs = r.share * first.endsAtMs;
  const place = { lat: r.to.lat + r.shiftDeg, lng: r.to.lng };
  const second = retargetFlight(
    first,
    atMs,
    orbitPose(WGS84_ELLIPSOID, place),
    {
      landingM: r.newLandingM,
    },
  );
  return { first, second, atMs, place };
}

describe("flight replan properties", () => {
  it("starts exactly where the camera was, with no jump in its velocity", () => {
    fc.assert(
      fc.property(replan, (r) => {
        const { first, second, atMs } = setUp(r);
        const a = flightCameraAt(first, atMs).position;
        const b = flightCameraAt(second, atMs).position;
        expect(b.distanceTo(a)).toBeLessThan(1e-3 + 1e-9 * a.length());
        const v = (t: number) =>
          flightCameraAt(second, t + 1)
            .position.sub(flightCameraAt(second, t - 1).position)
            .divideScalar(2);
        const before = v(atMs - 3);
        const after = v(atMs + 3);
        const scale = Math.max(before.length(), after.length(), 1e-6);
        expect(after.clone().sub(before).length() / scale).toBeLessThan(0.05);
      }),
      { numRuns: 150 },
    );
  });

  it("lands exactly at the new place and altitude, never below the lowest of its start and landings", () => {
    fc.assert(
      fc.property(replan, (r) => {
        const { second, place } = setUp(r);
        const end = flightFrameAt(second, second.endsAtMs);
        expect(end.done).toBe(true);
        expect(end.altitudeM).toBe(r.newLandingM);
        expect(
          end.centre.angleTo(orbitPose(WGS84_ELLIPSOID, place).direction),
        ).toBeLessThan(1e-9);
        const floor =
          Math.min(r.startKm * 1_000, r.landingM, r.newLandingM) * (1 - 1e-9);
        let lowest = Infinity;
        for (let t = 0; t <= second.endsAtMs; t += second.endsAtMs / 300) {
          lowest = Math.min(lowest, flightFrameAt(second, t).altitudeM);
        }
        expect(lowest).toBeGreaterThanOrEqual(floor);
      }),
      { numRuns: 150 },
    );
  });
});
