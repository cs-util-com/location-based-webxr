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
import { unitShare } from "./test-utils/arbitraries.js";
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
  /**
   * When, as a share of the first flight: the whole of it, its ramp and
   * its settle included (CF2 review finding 1: 5-95 % missed both).
   */
  // Even over the flight, both ends included (`unitShare`): a plain
  // double almost never drew a replan mid-flight.
  share: unitShare(fc),
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
        // A replanned flight answers from its replan on: the velocity
        // before it is the first flight's.
        const v = (flight: typeof first, t: number) =>
          flightCameraAt(flight, t + 1)
            .position.sub(flightCameraAt(flight, t - 1).position)
            .divideScalar(2);
        // One-sided over a quarter millisecond, each from the replan's own
        // point: a difference straddling it measured the braking of a
        // replan in the final settle (5 % in 6 ms) as a jump.
        // Small against the join and the flight's time left too (CF3 review
        // finding 4): in the last milliseconds the braking is hard, and a
        // step a tenth of them measured it as a 5 % jump.
        const left = Math.max(first.endsAtMs - atMs, 1e-3);
        const h = Math.min(
          0.25,
          (second.join?.spanMs ?? 250) / 1_000,
          left / 1_000,
        );
        const p = flightCameraAt(first, atMs).position;
        const before = p
          .clone()
          .sub(flightCameraAt(first, atMs - h).position)
          .divideScalar(h);
        const after = flightCameraAt(second, atMs + h)
          .position.sub(p)
          .divideScalar(h);
        // Against the speed half a second on as well: a replan at the press
        // itself meets a camera at rest, where both sides are near zero.
        const scale = Math.max(
          before.length(),
          after.length(),
          v(second, atMs + 500).length(),
          1e-6,
        );
        // Plus the positions' own resolution over the step: near the end the
        // camera is all but at rest, and a float64 position at the Earth's
        // radius resolves to about 1e-9 m, i.e. 1e-5 m/ms over a 1e-4 ms
        // step, which read as a 33 % jump of nothing.
        const resolution = (4 * p.length() * Number.EPSILON) / h;
        expect(after.clone().sub(before).length()).toBeLessThan(
          0.05 * scale + resolution,
        );
      }),
      { numRuns: 150 },
    );
  });

  it("lands exactly at the new place and altitude, never below the lowest of its start and landings", () => {
    fc.assert(
      fc.property(replan, (r) => {
        const { first, second, atMs, place } = setUp(r);
        const end = flightFrameAt(second, second.endsAtMs);
        expect(end.done).toBe(true);
        expect(end.altitudeM).toBe(r.newLandingM);
        expect(
          // The chord: angleTo's acos cannot tell under 1.5e-8 rad from 0.
          end.centre.distanceTo(orbitPose(WGS84_ELLIPSOID, place).direction),
        ).toBeLessThan(1e-9);
        const floor =
          Math.min(r.startKm * 1_000, r.landingM, r.newLandingM) * (1 - 1e-9);
        let lowest = Infinity;
        for (let t = 0; t <= second.endsAtMs; t += second.endsAtMs / 300) {
          const flight = t < atMs ? first : second;
          lowest = Math.min(lowest, flightFrameAt(flight, t).altitudeM);
        }
        expect(lowest).toBeGreaterThanOrEqual(floor);
      }),
      { numRuns: 150 },
    );
  });
});
