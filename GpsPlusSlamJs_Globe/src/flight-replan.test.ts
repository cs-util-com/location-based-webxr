/**
 * Why this test matters: the flight's target and landing are often not
 * final at the press (continuous-flight plan 2026-10-07-0941, CF2): the
 * device's fix arrives after it, the landing altitude rises once the
 * target's height tile loads, and a link can name a new place. A replan
 * that jumped, or bent with a kink, is exactly the "odd transition" the
 * owner reported. So:
 * - a replan starts exactly at the camera's current frame, and its speed
 *   and direction change without a jump (finite differences across it);
 * - the "never stops" criterion still holds across a replan;
 * - the replanned flight lands exactly at the new target and altitude;
 * - replans can follow each other, even within a blend;
 * - the landing is raised until the camera's whole final approach clears
 *   the ground under it (cold review finding 11: the camera sits behind
 *   the target, over ground the target's own height does not describe).
 */

import { describe, expect, it } from "vitest";

import type * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { orbitPose } from "./globe-camera.js";
import { obliqueCamera } from "./globe-dive.js";
import { FLIGHT_PATH } from "./flight-path.js";
import {
  FLIGHT_REPLAN,
  clearedLandingM,
  flightCameraAt,
  flightFrameAt,
  retargetFlight,
  startFlight,
  type Flight,
} from "./flight-replan.js";
import {
  noLateSurge,
  noStall,
  noStopAndGo,
  speedSamples,
  windowBetween,
  type SpeedSample,
} from "./test-utils/flight-speed.js";

const KM = 1_000;
const R = FLIGHT_PATH.radiusM;
const BERN = { lat: 46.948, lng: 7.4474 };
const ZURICH = { lat: 47.3769, lng: 8.5417 };
const NEW_YORK = { lat: 40.7128, lng: -74.006 };
const ROME = { lat: 41.9028, lng: 12.4964 };

/** The camera of a flight as a sampled point. */
const cameraPoint = (flight: Flight) => (t: number) => {
  const c = flightCameraAt(flight, t);
  return { altitudeM: c.altitudeM, direction: c.position.clone().normalize() };
};

function orbitStart(place: { lat: number; lng: number }, altitudeM: number) {
  const pose = orbitPose(WGS84_ELLIPSOID, place);
  const camera = obliqueCamera(WGS84_ELLIPSOID, pose, altitudeM, 90);
  return {
    pose,
    distanceM: camera.position.length(),
    quaternion: camera.quaternion,
  };
}

function flyFrom(
  place: { lat: number; lng: number },
  to: { lat: number; lng: number },
  landingM = 2 * KM,
) {
  return startFlight(
    WGS84_ELLIPSOID,
    orbitStart(place, 10_100 * KM),
    orbitPose(WGS84_ELLIPSOID, to),
    { landingM, durationMs: 15_000 },
    0,
  );
}

/** The camera's velocity (m/ms) by a central difference at `t`. */
function cameraVelocity(at: (t: number) => THREE.Vector3, t: number) {
  const h = 1;
  return at(t + h)
    .sub(at(t - h))
    .divideScalar(2 * h);
}

/**
 * The criterion across one replan of a New York-Bern flight, from the
 * first path's ramp to the replanned path's settle, at 10, 60 and 120 Hz
 * with all three tolerances; the failures, empty when it holds.
 */
function judgeReplan(c: {
  to: { lat: number; lng: number };
  atMs: number;
  landingM: number;
}): string[] {
  const first = flyFrom(NEW_YORK, BERN);
  const replanned = retargetFlight(
    first,
    c.atMs,
    orbitPose(WGS84_ELLIPSOID, c.to),
    {
      landingM: c.landingM,
    },
  );
  const fromMs = first.path.cruise?.fromMs ?? 0;
  const toMs = replanned.startedAtMs + (replanned.path.cruise?.toMs ?? 0);
  const tag = `${JSON.stringify(c.to)} landing ${c.landingM} at ${c.atMs} ms`;
  return [10, 60, 120].flatMap((hz) =>
    criterionAt(
      speedSamples(cameraPoint(replanned), replanned.endsAtMs, hz, R),
      fromMs,
      toMs,
      `${tag}, ${hz} Hz`,
    ),
  );
}

/** The criterion over one sampling's window; the failures, tagged. */
function criterionAt(
  samples: SpeedSample[],
  fromMs: number,
  toMs: number,
  tag: string,
): string[] {
  const w = windowBetween(samples, fromMs, toMs);
  const vs = w.map((x) => x.v);
  const bad: string[] = [];
  if (vs.length < 10) bad.push(`${tag}: ${vs.length} samples`);
  if (!noStall(vs, 0.5)) bad.push(`${tag}: (a)`);
  for (const tol of [0.1, 0.2, 0.3]) {
    if (!noStopAndGo(vs, tol)) bad.push(`${tag}: (b) ${tol}`);
  }
  if (!noLateSurge(w, 1.25)) bad.push(`${tag}: (c)`);
  return bad;
}

describe("retargetFlight", () => {
  // WHY: a replan that starts anywhere but the camera snaps the view.
  it("starts exactly at the camera's current frame", () => {
    const flight = flyFrom(NEW_YORK, BERN);
    const atMs = 6_000;
    const before = flightCameraAt(flight, atMs);
    const replanned = retargetFlight(
      flight,
      atMs,
      orbitPose(WGS84_ELLIPSOID, ZURICH),
      { landingM: 2 * KM },
    );
    const after = flightCameraAt(replanned, atMs);
    expect(after.position.distanceTo(before.position)).toBeLessThan(1e-3);
    expect(after.quaternion.angleTo(before.quaternion)).toBeLessThan(1e-9);
  });

  // WHY: a kink is a jolt even without a jump: the camera's velocity is
  // continuous across the replan.
  it("changes the camera's velocity without a jump", () => {
    for (const atMs of [3_000, 6_000, 10_000]) {
      const flight = flyFrom(NEW_YORK, BERN);
      const replanned = retargetFlight(
        flight,
        atMs,
        orbitPose(WGS84_ELLIPSOID, ZURICH),
        { landingM: 2 * KM },
      );
      const pos = (t: number) => flightCameraAt(replanned, t).position;
      const before = cameraVelocity(pos, atMs - 2);
      const after = cameraVelocity(pos, atMs + 2);
      const scale = Math.max(before.length(), 1e-9);
      expect(after.clone().sub(before).length() / scale).toBeLessThan(0.02);
    }
  });

  // WHY: the owner's "never stops in between" must survive the replans
  // the design makes (DEC-CF-4b: the target is known before the camera
  // leaves about 2,000 km, so a NEW PLACE comes only up there; a NEW
  // LANDING, the target's height tile arriving, comes at any altitude).
  // Measured on the camera, from the first path's ramp to the replanned
  // path's settle, at 10, 60 and 120 Hz, all three tolerances. A new place
  // low down is the documented limit (the next test).
  it("keeps the criterion across the replans the design makes", () => {
    const places = [ZURICH, ROME].flatMap((to) =>
      [1_000, 2_000, 3_000].map((atMs) => ({ to, atMs, landingM: 2 * KM })),
    );
    const landings = [2_000, 5_000, 8_000, 11_000].flatMap((atMs) =>
      [3 * KM, 1.5 * KM].map((landingM) => ({ to: BERN, atMs, landingM })),
    );
    // The scoping, asserted: a new place only above the band.
    const lowest = Math.min(
      ...places.map(
        ({ atMs }) => flightFrameAt(flyFrom(NEW_YORK, BERN), atMs).altitudeM,
      ),
    );
    expect(lowest).toBeGreaterThan(2_000 * KM);
    const bad = [...places, ...landings].flatMap((c) => judgeReplan(c));
    expect(bad).toEqual([]);
  });

  // WHY (the documented limit, continuous-flight plan CF2): a new PLACE
  // low down (a new link mid-flight; the design's own fix comes above the
  // band) turns the course, or the descent into a climb (the van Wijk
  // arch), and the 1.5 s cross-fade between the two flights dips and surges
  // the speed: measured 2026-10-07 at 0.62-0.84 and up to 2.74 x the speed
  // before (Zurich from 79 km, Rome from 609 and from 10 km, which climbs
  // to 345 km). It must still never stall and must land exactly; a C1 turn
  // in place of the cross-fade is the filed follow-up should such replans
  // become part of the design.
  it("bends to a new place low down without stalling, and lands exactly", () => {
    for (const [to, atMs] of [
      [ZURICH, 8_000],
      [ROME, 5_000],
      [ROME, 11_000],
    ] as const) {
      const first = flyFrom(NEW_YORK, BERN);
      const replanned = retargetFlight(
        first,
        atMs,
        orbitPose(WGS84_ELLIPSOID, to),
        { landingM: 2 * KM },
      );
      const w = windowBetween(
        speedSamples(cameraPoint(replanned), replanned.endsAtMs, 60, R),
        first.path.cruise?.fromMs ?? 0,
        replanned.startedAtMs + (replanned.path.cruise?.toMs ?? 0),
      ).map((x) => x.v);
      expect(noStall(w, 0.5), `${JSON.stringify(to)} at ${atMs} ms`).toBe(true);
      const end = flightFrameAt(replanned, replanned.endsAtMs);
      const place = orbitPose(WGS84_ELLIPSOID, to).direction;
      expect(end.centre.angleTo(place)).toBeLessThan(1e-9);
    }
  });

  // WHY: a replan that missed its own end would land somewhere else.
  it("lands exactly at the new target and altitude", () => {
    const replanned = retargetFlight(
      flyFrom(NEW_YORK, BERN),
      7_000,
      orbitPose(WGS84_ELLIPSOID, ZURICH),
      { landingM: 3 * KM },
    );
    const end = flightFrameAt(replanned, replanned.endsAtMs);
    expect(end.done).toBe(true);
    expect(end.altitudeM).toBeCloseTo(3 * KM, 6);
    const zurich = orbitPose(WGS84_ELLIPSOID, ZURICH).direction;
    expect(end.centre.angleTo(zurich)).toBeLessThan(1e-9);
    expect(flightFrameAt(replanned, replanned.endsAtMs - 1).done).toBe(false);
  });

  // WHY: a second replan (the landing rising after the fix) can come
  // while the first still blends.
  it("takes a replan within a blend without a jump", () => {
    const first = retargetFlight(
      flyFrom(NEW_YORK, BERN),
      5_000,
      orbitPose(WGS84_ELLIPSOID, ZURICH),
      { landingM: 2 * KM },
    );
    const atMs = 5_000 + FLIGHT_REPLAN.blendMs / 2;
    const second = retargetFlight(
      first,
      atMs,
      orbitPose(WGS84_ELLIPSOID, ZURICH),
      { landingM: 2.5 * KM },
    );
    const pos = (t: number) => flightCameraAt(second, t).position;
    expect(
      pos(atMs).distanceTo(flightCameraAt(first, atMs).position),
    ).toBeLessThan(1e-3);
    const before = cameraVelocity(pos, atMs - 2);
    const after = cameraVelocity(pos, atMs + 2);
    expect(after.clone().sub(before).length() / before.length()).toBeLessThan(
      0.02,
    );
    expect(flightFrameAt(second, second.endsAtMs).altitudeM).toBeCloseTo(
      2.5 * KM,
      6,
    );
  });

  // WHY: after the landing a new place flies from rest, as a press.
  it("flies a replan after the landing from the landed frame", () => {
    const flight = flyFrom(ZURICH, BERN);
    const landed = flightCameraAt(flight, flight.endsAtMs);
    const again = retargetFlight(
      flight,
      flight.endsAtMs + 1_000,
      orbitPose(WGS84_ELLIPSOID, ZURICH),
      { landingM: 2 * KM },
    );
    const start = flightCameraAt(again, flight.endsAtMs + 1_000);
    expect(start.position.distanceTo(landed.position)).toBeLessThan(1e-3);
    expect(flightFrameAt(again, again.endsAtMs).done).toBe(true);
  });

  it("rejects a replan before the flight began", () => {
    const flight = flyFrom(NEW_YORK, BERN);
    expect(() =>
      retargetFlight(flight, -1, orbitPose(WGS84_ELLIPSOID, ZURICH), {
        landingM: 2 * KM,
      }),
    ).toThrow(RangeError);
  });
});

describe("clearedLandingM", () => {
  const bern = orbitPose(WGS84_ELLIPSOID, BERN).direction;
  /**
   * Mountains 3,000 m high in a ring 1-8 km around Bern, the target itself
   * at 500 m: whichever way the camera comes in, it lands over the ring.
   */
  function ridge(direction: THREE.Vector3): number {
    const km = (direction.angleTo(bern) * R) / KM;
    return km > 1 && km < 8 ? 3_000 : 500;
  }

  // WHY (cold review finding 11): at 45 degrees the camera lands about one
  // landing altitude behind the target, here over the ring, which the
  // target's own height (500 m) does not describe.
  it("raises the landing until the camera's final approach clears the ground", () => {
    const start = orbitStart(ZURICH, 10_100 * KM);
    const target = orbitPose(WGS84_ELLIPSOID, BERN);
    const landingM = clearedLandingM(
      WGS84_ELLIPSOID,
      start,
      target,
      { landingM: 2 * KM, durationMs: 15_000 },
      ridge,
    );
    const flight = startFlight(
      WGS84_ELLIPSOID,
      start,
      target,
      { landingM, durationMs: 15_000 },
      0,
    );
    let worst = Infinity;
    for (let t = 0; t <= flight.endsAtMs; t += 20) {
      const cam = flightCameraAt(flight, t);
      // The camera stands at its frame's altitude above the surface, over
      // the ground under its own position (not the view's centre).
      const ground = ridge(cam.position.clone().normalize());
      const above = cam.altitudeM - ground;
      if (cam.altitudeM < 20 * KM) worst = Math.min(worst, above);
    }
    expect(landingM).toBeGreaterThan(2 * KM);
    expect(worst).toBeGreaterThanOrEqual(FLIGHT_REPLAN.clearanceM - 1);
  });

  it("keeps the landing where the approach already clears", () => {
    const flat = () => 500;
    expect(
      clearedLandingM(
        WGS84_ELLIPSOID,
        orbitStart(ZURICH, 10_100 * KM),
        orbitPose(WGS84_ELLIPSOID, BERN),
        { landingM: 2 * KM, durationMs: 15_000 },
        flat,
      ),
    ).toBe(2 * KM);
  });

  it("ignores ground that is not known yet", () => {
    expect(
      clearedLandingM(
        WGS84_ELLIPSOID,
        orbitStart(ZURICH, 10_100 * KM),
        orbitPose(WGS84_ELLIPSOID, BERN),
        { landingM: 2 * KM, durationMs: 15_000 },
        () => null,
      ),
    ).toBe(2 * KM);
  });
});
