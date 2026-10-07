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

/**
 * The flight in force at `t` among a flight and its replans (a replanned
 * `Flight` answers from its replan on: it keeps no history).
 */
const pick =
  (...flights: Flight[]) =>
  (t: number): Flight =>
    flights.filter((f) => f.startedAtMs <= t).at(-1) ?? (flights[0] as Flight);

/** The camera of a flight and its replans as a sampled point. */
const cameraPoint =
  (...flights: Flight[]) =>
  (t: number) => {
    const c = flightCameraAt(pick(...flights)(t), t);
    return {
      altitudeM: c.altitudeM,
      direction: c.position.clone().normalize(),
    };
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
      speedSamples(cameraPoint(first, replanned), replanned.endsAtMs, hz, R),
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
      const pos = (t: number) =>
        flightCameraAt(pick(flight, replanned)(t), t).position;
      // At the replan, and where the join ends (CF2 review finding 3: at
      // the replan the two coincide, so any join shape is continuous there;
      // only its end can show a wrong one).
      for (const at of [atMs, atMs + FLIGHT_REPLAN.joinMs]) {
        const before = cameraVelocity(pos, at - 2);
        const after = cameraVelocity(pos, at + 2);
        const scale = Math.max(before.length(), 1e-9);
        expect(
          after.clone().sub(before).length() / scale,
          `at ${at} ms`,
        ).toBeLessThan(0.02);
      }
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
  // arch). The join corrects the velocity, so a moderate turn dips but
  // never stalls (measured 2026-10-07: 0.79 from Zurich at 79 km, 0.81
  // from Rome at 609 km), while a full REVERSAL (Rome from 10 km: a fast
  // descent becomes a climb to 345 km) passes through a near-stop, 0.03 of
  // its speed for about 0.2 s, as any velocity blend must; only a turn at
  // a constant speed avoids it, the filed follow-up should such replans
  // become part of the design. Both land exactly.
  it("bends to a new place low down: moderate turns never stall, a reversal turns around, all land exactly", () => {
    const cases = [
      { to: ZURICH, atMs: 8_000, reversal: false },
      { to: ROME, atMs: 5_000, reversal: false },
      { to: ROME, atMs: 11_000, reversal: true },
    ];
    for (const { to, atMs, reversal } of cases) {
      const first = flyFrom(NEW_YORK, BERN);
      const replanned = retargetFlight(
        first,
        atMs,
        orbitPose(WGS84_ELLIPSOID, to),
        { landingM: 2 * KM },
      );
      const tag = `${JSON.stringify(to)} at ${atMs} ms`;
      const w = windowBetween(
        speedSamples(cameraPoint(first, replanned), replanned.endsAtMs, 60, R),
        first.path.cruise?.fromMs ?? 0,
        replanned.startedAtMs + (replanned.path.cruise?.toMs ?? 0),
      ).map((x) => x.v);
      let top = 0;
      for (let t = atMs; t < replanned.endsAtMs; t += 50) {
        top = Math.max(top, flightFrameAt(replanned, t).altitudeM);
      }
      // A reversal climbs well above where it turned; a turn does not.
      const turnedAt = flightFrameAt(first, atMs).altitudeM;
      expect(top > 1.5 * turnedAt, tag).toBe(reversal);
      expect(noStall(w, 0.5), tag).toBe(!reversal);
      const end = flightFrameAt(replanned, replanned.endsAtMs);
      const place = orbitPose(WGS84_ELLIPSOID, to).direction;
      expect(end.centre.distanceTo(place), tag).toBeLessThan(1e-9);
    }
  });

  // WHY (CF2 review finding 1): a replan to the SAME target and landing
  // must leave the flight as it was, at any moment: in the press's ramp a
  // replan copied the instant speed and the flight crawled to the 60 s cap;
  // in the final settle it cruised at the settle's speed and settled again
  // (and dipped up to 7.6 m below a 1 km landing, measured). Checked from
  // the ramp to the last half second.
  it("leaves the flight unchanged when nothing changes, at any moment", () => {
    const bad: string[] = [];
    for (const atMs of [
      100, 300, 500, 3_000, 9_000, 13_000, 14_500, 14_900, 14_990,
    ]) {
      const first = flyFrom(NEW_YORK, BERN);
      const same = retargetFlight(
        first,
        atMs,
        orbitPose(WGS84_ELLIPSOID, BERN),
        { landingM: 2 * KM },
      );
      if (Math.abs(same.endsAtMs - first.endsAtMs) > 0.03 * 15_000) {
        bad.push(
          `at ${atMs} ms: ends at ${same.endsAtMs.toFixed(0)} ms, not ${first.endsAtMs}`,
        );
      }
      let worst = 0;
      for (let t = atMs; t <= first.endsAtMs; t += 25) {
        const a = flightCameraAt(first, t);
        const b = flightCameraAt(same, t);
        worst = Math.max(
          worst,
          a.position.distanceTo(b.position) / a.altitudeM,
        );
      }
      // Within 5 % of the altitude at every moment (timing, not place).
      if (worst > 0.05)
        bad.push(
          `at ${atMs} ms: apart up to ${(worst * 100).toFixed(1)} % of the altitude`,
        );
    }
    expect(bad).toEqual([]);
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
    expect(end.centre.distanceTo(zurich)).toBeLessThan(1e-9);
    expect(flightFrameAt(replanned, replanned.endsAtMs - 1).done).toBe(false);
  });

  // WHY: a second replan (the landing rising after the fix) can come
  // while the first still joins.
  it("takes a replan within a join without a jump", () => {
    const first = retargetFlight(
      flyFrom(NEW_YORK, BERN),
      5_000,
      orbitPose(WGS84_ELLIPSOID, ZURICH),
      { landingM: 2 * KM },
    );
    const atMs = 5_000 + FLIGHT_REPLAN.joinMs / 2;
    const second = retargetFlight(
      first,
      atMs,
      orbitPose(WGS84_ELLIPSOID, ZURICH),
      { landingM: 2.5 * KM },
    );
    const pos = (t: number) =>
      flightCameraAt(pick(first, second)(t), t).position;
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

  // WHY (CF2 review finding 4): a shortfall the landing cannot change (a
  // start already too low over a plateau) was added again every round: a
  // start at 2,000 m over a 1,800 m plateau got a 2,600 m landing where
  // 2,100 m clears it.
  it("raises only for ground the landing can clear", () => {
    const plateau = () => 1_800;
    const landingM = clearedLandingM(
      WGS84_ELLIPSOID,
      orbitStart(ZURICH, 2 * KM),
      orbitPose(WGS84_ELLIPSOID, BERN),
      { landingM: 2 * KM, durationMs: 15_000 },
      plateau,
    );
    expect(landingM).toBeGreaterThanOrEqual(
      1_800 + FLIGHT_REPLAN.clearanceM - 1,
    );
    expect(landingM).toBeLessThan(1_800 + FLIGHT_REPLAN.clearanceM + 50);
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
