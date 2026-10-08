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

/**
 * A same-target replan of `flight` where it reaches `km`: the worst
 * distance, over the altitude, between the replanned flight and the original
 * at the same altitude (timing aside: the same curve or not).
 */
function sameCurveDeviation(flight: Flight, km: number): number {
  let atMs = 0;
  while (flightFrameAt(flight, atMs).altitudeM > km * KM) atMs += 1;
  const same = retargetFlight(flight, atMs, orbitPose(WGS84_ELLIPSOID, BERN), {
    landingM: 2 * KM,
  });
  const old: { h: number; dir: THREE.Vector3 }[] = [];
  for (let t = atMs; t <= flight.endsAtMs; t += 2) {
    const f = flightFrameAt(flight, t);
    old.push({ h: f.altitudeM, dir: f.camera.clone() });
  }
  let worst = 0;
  let j = 0;
  for (let t = atMs + 50; t < same.endsAtMs - 50; t += 10) {
    const f = flightFrameAt(same, t);
    while (j < old.length - 1 && (old[j + 1]?.h ?? 0) >= f.altitudeM) j++;
    const o = old[j];
    if (!o) continue;
    worst = Math.max(worst, (o.dir.angleTo(f.camera) * R) / f.altitudeM);
  }
  return worst;
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
    // A new place at three altitudes above the band (6,000, 4,000 and
    // 2,500 km), found on the flight itself rather than at fixed times, so
    // the scoping holds whatever the curve.
    const base = flyFrom(NEW_YORK, BERN);
    const reaching = (km: number) => {
      let t = 0;
      while (flightFrameAt(base, t).altitudeM > km * KM) t += 10;
      return t;
    };
    const places = [ZURICH, ROME].flatMap((to) =>
      [6_000, 4_000, 2_500].map((km) => ({
        to,
        atMs: reaching(km),
        landingM: 2 * KM,
      })),
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
  it("bends to a new place low down: moderate turns never stall, a reversal passes a near-stop, none climbs, all land exactly", () => {
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
      // No replan climbs: the travel curve pans at its altitude (round-2
      // R1; van Wijk's geodesic climbed for a reversal).
      const turnedAt = flightFrameAt(first, atMs).altitudeM;
      expect(top, tag).toBeLessThanOrEqual(turnedAt * (1 + 1e-6));
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
    // Every 350 ms across the flight, and its last moments (CF3 review
    // finding 3: a sparse list skipped the failing 8.8-11.6 s window).
    const moments = [
      ...Array.from({ length: 43 }, (_, i) => 100 + i * 350),
      14_900,
      14_990,
    ];
    for (const atMs of moments) {
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

  // WHY (R1 milestone review, finding 2): the travel curve's turn is
  // self-similar, so a replan that changes nothing flies on along the very
  // same curve: at every altitude over the same ground. Its band margin
  // broke that between the bend and 1.65 x it (0.8-2.5 % of the altitude
  // apart), which the timing test above, at 5 %, let through.
  it("flies on along the same curve when nothing changes, from any altitude", () => {
    const bad: string[] = [];
    const first = flyFrom(NEW_YORK, BERN);
    for (const km of [1_000, 170, 164, 150, 130, 101, 99, 50, 24, 22, 10]) {
      const worst = sameCurveDeviation(first, km);
      if (worst > 2e-3)
        bad.push(`from ${km} km: ${(worst * 100).toFixed(2)} %`);
    }
    // And from a start a few hundred km up (R1 re-review finding 2: a
    // replan's own turn left chose a lower end, and the flight went up to
    // 7,778 % of the altitude off its curve). Measured 0.11-0.26 %, and
    // 1.43 % for a replan at 8 km: inside the velocity join (up to 50 m at
    // 3.6 km, gone when it ends), a small velocity mismatch filed for a
    // look (the plan, §9).
    const low = startFlight(
      WGS84_ELLIPSOID,
      orbitStart(NEW_YORK, 500 * KM),
      orbitPose(WGS84_ELLIPSOID, BERN),
      { landingM: 2 * KM, durationMs: 15_000 },
      0,
    );
    for (const km of [101, 60, 40, 30, 15, 8]) {
      const worst = sameCurveDeviation(low, km);
      if (worst > 2e-2) {
        bad.push(`500 km start, from ${km} km: ${(worst * 100).toFixed(2)} %`);
      }
    }
    expect(bad).toEqual([]);
  });

  // WHY (R1 milestone review, finding 3): a replan in a flight's last
  // moments starts within metres of the landing's altitude; its nearly
  // level travel put the view at the horizon floor for most of the new
  // flight and snapped it 38.6 degrees at the end.
  it("never snaps the view after a replan in the last moments", () => {
    const first = flyFrom(NEW_YORK, BERN);
    for (const to of [ROME, ZURICH]) {
      for (const left of [500, 100, 20, 5, 1]) {
        const atMs = first.endsAtMs - left;
        const late = retargetFlight(
          first,
          atMs,
          orbitPose(WGS84_ELLIPSOID, to),
          {
            landingM: 2 * KM,
          },
        );
        let worst = 0;
        let last = flightFrameAt(late, atMs).pitchDeg;
        for (let t = atMs; t <= late.endsAtMs; t += 1000 / 60) {
          const p = flightFrameAt(late, t).pitchDeg;
          worst = Math.max(worst, Math.abs(p - last));
          last = p;
        }
        expect(worst, `${JSON.stringify(to)}, ${left} ms left`).toBeLessThan(3);
      }
    }
  });

  // WHY (CF3 review finding 2): a fix late in the hold (its settle) must
  // fly on at a normal pace: braking on applies only to the SAME
  // destination; a new one crawled for up to 60 s.
  it("flies a new place at a normal pace even from the old flight's settle", () => {
    const hold = startFlight(
      WGS84_ELLIPSOID,
      orbitStart(NEW_YORK, 10_100 * KM),
      orbitPose(WGS84_ELLIPSOID, NEW_YORK),
      { landingM: 2_000 * KM, viewLandingM: 2 * KM, durationMs: 15_000 },
      0,
    );
    const fresh = startFlight(
      WGS84_ELLIPSOID,
      orbitStart(NEW_YORK, 2_100 * KM),
      orbitPose(WGS84_ELLIPSOID, BERN),
      { landingM: 2 * KM, durationMs: 15_000 },
      0,
    );
    for (const atMs of [9_000, 12_000, 14_000]) {
      const replanned = retargetFlight(
        hold,
        atMs,
        orbitPose(WGS84_ELLIPSOID, BERN),
        { landingM: 2 * KM },
      );
      expect(replanned.path.durationMs, `at ${atMs} ms`).toBeLessThan(
        1.5 * fresh.path.durationMs,
      );
    }
  });

  // WHY (CF3 review finding 5): the view's pitch blended from the start to
  // the law with a weight whose slope is 0 at the start, so every replan
  // froze the view's turn (14 deg/s to 0) for a moment. The new path
  // carries the turn on.
  it("keeps the view turning across a replan", () => {
    const rate = (flight: Flight, t: number) =>
      flightCameraAt(flight, t + 5).quaternion.angleTo(
        flightCameraAt(flight, t).quaternion,
      ) / 5;
    for (const atMs of [6_000, 12_000]) {
      const first = flyFrom(NEW_YORK, BERN);
      const same = retargetFlight(
        first,
        atMs,
        orbitPose(WGS84_ELLIPSOID, BERN),
        {
          landingM: 2 * KM,
        },
      );
      const before = rate(first, atMs - 5);
      const after = rate(same, atMs);
      expect(Math.abs(after - before) / before, `at ${atMs} ms`).toBeLessThan(
        0.2,
      );
    }
  });

  // WHY (CF3 review finding 8, J1): the join's shape x (1 - x/T)^3 is
  // claimed C2 at its end; the squared form left an acceleration jump of
  // 2 dv / T there that no test saw.
  it("ends its join without a jump in the acceleration", () => {
    const first = flyFrom(NEW_YORK, BERN);
    const replanned = retargetFlight(
      first,
      6_000,
      orbitPose(WGS84_ELLIPSOID, ZURICH),
      { landingM: 2 * KM },
    );
    const end = 6_000 + (replanned.join?.spanMs ?? 0);
    const h = 2;
    const acc = (t: number) => {
      const p = (x: number) => flightCameraAt(replanned, x).position;
      return p(t + h)
        .add(p(t - h))
        .sub(p(t).multiplyScalar(2))
        .divideScalar(h * h);
    };
    const before = acc(end - 3 * h);
    const after = acc(end + 3 * h);
    const scale = Math.max(before.length(), after.length());
    expect(after.clone().sub(before).length() / scale).toBeLessThan(0.1);
  });

  // WHY (CF3 review finding 8, J2): a replan in a flight's last moments
  // brakes over a few milliseconds; a join longer than that held the
  // landed camera below its landing (measured 1.6 %).
  it("never lets a join outlive its flight", () => {
    const first = flyFrom(NEW_YORK, BERN);
    for (const left of [200, 20, 2]) {
      const atMs = first.endsAtMs - left;
      const replanned = retargetFlight(
        first,
        atMs,
        orbitPose(WGS84_ELLIPSOID, BERN),
        { landingM: 2 * KM },
      );
      expect(replanned.join?.spanMs ?? 0).toBeLessThanOrEqual(
        replanned.path.durationMs,
      );
      let lowest = Infinity;
      for (let t = atMs; t <= replanned.endsAtMs + 50; t += left / 50) {
        lowest = Math.min(lowest, flightFrameAt(replanned, t).altitudeM);
      }
      expect(lowest, `${left} ms left`).toBeGreaterThanOrEqual(
        2 * KM * (1 - 1e-9),
      );
    }
  });

  // WHY (a property counterexample, 2026-10-08): a replan a few metres
  // above the landing to a place 100 m to 10 km away, in the last few
  // percent of a flight, carried the old descent into a nearly level path:
  // up to 0.65 m under a 1 km landing and 1.8 m under a 5 km one (1.3 um
  // at the property's 300 samples; R4/R5 milestone review). The landing
  // is the lowest the camera may go, so the join must respect it.
  it("never lets a join take the camera below its landing", () => {
    const failures: string[] = [];
    for (const shiftDeg of [0.005, 0.01, 0.05]) {
      for (const share of [0.95, 0.9685, 0.99]) {
        const pose = orbitPose(WGS84_ELLIPSOID, { lat: 0, lng: 0 });
        const cam = obliqueCamera(WGS84_ELLIPSOID, pose, 3_000 * KM, 90);
        const first = startFlight(
          WGS84_ELLIPSOID,
          {
            pose,
            distanceM: cam.position.length(),
            quaternion: cam.quaternion,
          },
          pose,
          { landingM: KM, durationMs: 15_000 },
          0,
        );
        const atMs = share * first.endsAtMs;
        const second = retargetFlight(
          first,
          atMs,
          orbitPose(WGS84_ELLIPSOID, { lat: shiftDeg, lng: 0 }),
          { landingM: KM },
        );
        const floor =
          Math.min(flightFrameAt(first, atMs).altitudeM, KM) * (1 - 1e-12);
        let lowest = Infinity;
        for (let i = 0; i <= 3_000; i++) {
          const t = atMs + ((second.endsAtMs - atMs) * i) / 3_000;
          lowest = Math.min(lowest, flightFrameAt(second, t).altitudeM);
        }
        if (lowest < floor) {
          failures.push(
            `${shiftDeg} deg at ${share}: ${(lowest - floor).toExponential(2)} m`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  // WHY (R4/R5 milestone review): a landing raised over the camera (a
  // late height tile over mountains) is a climb replan. A join floor at
  // the replan's own altitude stopped the camera's descent dead there
  // (radial velocity -0.457 to 0 m/ms), a jump of the whole speed.
  it("joins a climb to a raised landing without a jump in the velocity", () => {
    const pose = orbitPose(WGS84_ELLIPSOID, BERN);
    const cam = obliqueCamera(WGS84_ELLIPSOID, pose, 40_000 * KM, 90);
    const first = startFlight(
      WGS84_ELLIPSOID,
      { pose, distanceM: cam.position.length(), quaternion: cam.quaternion },
      orbitPose(WGS84_ELLIPSOID, ZURICH),
      { landingM: KM, durationMs: 15_000 },
      0,
    );
    for (const share of [0.85, 0.9, 0.95]) {
      const atMs = share * first.endsAtMs;
      const second = retargetFlight(
        first,
        atMs,
        orbitPose(WGS84_ELLIPSOID, {
          lat: ZURICH.lat + 0.5,
          lng: ZURICH.lng,
        }),
        { landingM: 1.5 * KM },
      );
      const h = 0.25;
      const p = flightCameraAt(first, atMs).position;
      const before = p
        .clone()
        .sub(flightCameraAt(first, atMs - h).position)
        .divideScalar(h);
      const after = flightCameraAt(second, atMs + h)
        .position.sub(p)
        .divideScalar(h);
      expect(
        after.clone().sub(before).length() / before.length(),
        `at ${share}`,
      ).toBeLessThan(0.05);
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
  // CF2 review finding 4: a start already too low over its own ground was
  // added again every round. Two starts: at the landing's own altitude over
  // a 1,800 m plateau (a level pan on the travel curve), and a descent from
  // 10 km whose first stretch sits too low over a ridge (9,800 m under the
  // start only) that the landing cannot move. Round-2 R1: on the travel
  // curve a landing scales the whole descent a little, and before the
  // final-approach rule these read 3,752 m and 6,020 m.
  it("raises only for ground the landing can clear", () => {
    const zurich = orbitPose(WGS84_ELLIPSOID, ZURICH).direction;
    const ridge = (d: THREE.Vector3) =>
      d.angleTo(zurich) * R < 5 * KM ? 9_800 : 1_800;
    const need = 1_800 + FLIGHT_REPLAN.clearanceM;
    // The level pan (a start at the landing's altitude) is a climb to the
    // landing; with the 0.5 floor the landing governs its second half, where
    // halfway the altitude is the geometric mean of start and landing, so it
    // comes to need^2 / 2,000 = 2,205 m (a regression pin of that rule, not
    // a requirement: the pan's first half stays under the clearance). The
    // descent from 10 km clears the plateau at the plain need, the ridge
    // under its start out of the landing's reach.
    for (const [startM, groundAt, low, high] of [
      [
        2 * KM,
        () => 1_800,
        (need * need) / (2 * KM) - 10,
        (need * need) / (2 * KM) + 10,
      ],
      [10 * KM, ridge, need - 1, need + 50],
    ] as const) {
      const landingM = clearedLandingM(
        WGS84_ELLIPSOID,
        orbitStart(ZURICH, startM),
        orbitPose(WGS84_ELLIPSOID, BERN),
        { landingM: 2 * KM, durationMs: 15_000 },
        groundAt,
      );
      expect(landingM, `from ${startM} m`).toBeGreaterThanOrEqual(low);
      expect(landingM, `from ${startM} m`).toBeLessThan(high);
    }
  });

  // WHY (R1 milestone review, finding 5): ground just before the dive is
  // what the landing must clear; a final-approach window (the dive's own
  // track) ignored ridges 9-12 km out and left the camera inside them.
  // A ridge 100 m under the planned path, at 5-40 km from the landing
  // point, must be cleared by about the full clearance.
  it("clears a ridge anywhere on the approach", () => {
    const bad: string[] = [];
    for (const startKm of [5, 10]) {
      const plan = (landingM: number) =>
        startFlight(
          WGS84_ELLIPSOID,
          orbitStart(ZURICH, startKm * KM),
          orbitPose(WGS84_ELLIPSOID, BERN),
          { landingM, durationMs: 15_000 },
          0,
        );
      const planned = plan(2 * KM);
      const end = planned.path.cameraEnd;
      const altitudeAt = (dKm: number) => {
        for (let t = 0; t <= planned.endsAtMs; t += 2) {
          const f = flightFrameAt(planned, t);
          if ((f.camera.angleTo(end) * R) / KM <= dKm) return f.altitudeM;
        }
        return Number.NaN;
      };
      for (const dKm of [40, 20, 12, 9, 7, 5]) {
        const top = altitudeAt(dKm) - 100;
        const ridge = (d: THREE.Vector3) =>
          Math.abs((d.angleTo(end) * R) / KM - dKm) < 1 ? top : 500;
        const landingM = clearedLandingM(
          WGS84_ELLIPSOID,
          orbitStart(ZURICH, startKm * KM),
          orbitPose(WGS84_ELLIPSOID, BERN),
          { landingM: 2 * KM, durationMs: 15_000 },
          ridge,
        );
        const flown = plan(landingM);
        let clear = Infinity;
        for (let t = 0; t <= flown.endsAtMs; t += 5) {
          const f = flightFrameAt(flown, t);
          clear = Math.min(clear, f.altitudeM - ridge(f.camera));
        }
        if (clear < FLIGHT_REPLAN.clearanceM - 20) {
          bad.push(
            `from ${startKm} km, a ridge ${dKm} km out: ${clear.toFixed(0)} m clear`,
          );
        }
      }
    }
    expect(bad).toEqual([]);
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
