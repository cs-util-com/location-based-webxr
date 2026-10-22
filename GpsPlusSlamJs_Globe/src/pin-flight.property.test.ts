/**
 * Why this test matters: the pin's flight runs from a random press, with a
 * fix and data arriving whenever the network lets them (continuous-flight
 * plan 2026-10-07-0941, CF3; the CF3 milestone review asked for this, as
 * the project requires a property test for every component). Over random
 * starts, targets, landings, fix times and data (steady progress or all at
 * once), simulated at 30 Hz:
 * - DEC-CF-3b: the camera never goes below the commit altitude before its
 *   data is ready, unless the 60 s cap opened the gate (DEC-CF-5);
 * - it never goes below its landing;
 * - it always lands, exactly at its landing.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { orbitPose } from "./globe-camera.js";
import { obliqueCamera } from "./globe-dive.js";
import {
  PIN_FLIGHT,
  pinFix,
  pinFrame,
  pinProgress,
  pressPin,
} from "./pin-flight.js";

const KM = 1_000;
const DT = 1000 / 30;

const place = fc.record({
  lat: fc.double({ min: -70, max: 70, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

const press = fc.record({
  from: place,
  to: place,
  startKm: fc.double({ min: 2_500, max: 40_000, noNaN: true }),
  landingM: fc.double({ min: 1_000, max: 20_000, noNaN: true }),
  fixAtMs: fc.oneof(fc.constant(0), fc.integer({ min: 100, max: 14_000 })),
  dataMs: fc.integer({ min: 200, max: 70_000 }),
  steady: fc.boolean(),
});

type Press = typeof press extends fc.Arbitrary<infer T> ? T : never;

/** The data's progress at `t`: steady from the fix, or all at once. */
function progressAt(r: Press, t: number): number {
  const x = (t - r.fixAtMs) / r.dataMs;
  if (r.steady) return Math.min(1, Math.max(0, x));
  return x >= 1 ? 1 : 0;
}

/** What is wrong with altitude `h` at `t`, or null. */
function problemAt(r: Press, t: number, h: number): string | null {
  const readyAt = r.fixAtMs + r.dataMs;
  const capped = t >= PIN_FLIGHT.safetyCapMs;
  if (!capped && t < readyAt - DT && h < PIN_FLIGHT.commitM * 0.999) {
    return `below the commit altitude at ${t.toFixed(0)} ms`;
  }
  if (h < r.landingM * (1 - 1e-9)) {
    return `below the landing at ${t.toFixed(0)} ms`;
  }
  return null;
}

describe("the pin's flight, properties", () => {
  it("keeps its data guarantee, never goes below its landing, and lands exactly", () => {
    fc.assert(
      fc.property(press, (r) => {
        const pose = orbitPose(WGS84_ELLIPSOID, r.from);
        const cam = obliqueCamera(WGS84_ELLIPSOID, pose, r.startKm * KM, 90);
        const target = orbitPose(WGS84_ELLIPSOID, r.to);
        let pin = pressPin(
          WGS84_ELLIPSOID,
          0,
          {
            pose,
            distanceM: cam.position.length(),
            quaternion: cam.quaternion,
          },
          {
            target: r.fixAtMs === 0 ? target : null,
            landingM: r.landingM,
            progress: 0,
          },
        );
        let problem: string | null = null;
        let lastH = Infinity;
        for (let t = DT; t <= 150_000 && pin.phase !== "landed"; t += DT) {
          if (t >= r.fixAtMs && pin.phase === "holding") {
            pin = pinFix(pin, t, target);
          }
          pin = pinProgress(pin, t, progressAt(r, t));
          const out = pinFrame(pin, t);
          pin = out.pin;
          const h = out.camera?.altitudeM ?? lastH;
          lastH = h;
          problem = problemAt(r, t, h);
          if (problem) break;
        }
        expect(problem).toBeNull();
        expect(pin.phase).toBe("landed");
        expect(lastH).toBeCloseTo(r.landingM, 3);
      }),
      { numRuns: 25 },
    );
  });
});
