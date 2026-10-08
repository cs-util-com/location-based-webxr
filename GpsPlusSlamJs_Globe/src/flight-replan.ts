/**
 * The flight's replans (continuous-flight plan 2026-10-07-0941, CF2): a
 * changed target (the device's fix after the press, a new link) or a
 * changed landing (the target's height tile arrives) replans the flight
 * from the camera's current state, without a jump or a kink. Pure: a
 * `Flight` value in, a new one out; frames and cameras by time.
 *
 * A replan starts a new `flight-path` from the camera as it is (its
 * direction, altitude, view and tilt), at its current speed (ramping up to
 * a fresh flight's cruise if slower). The new path's first velocity
 * differs from the camera's in direction, so a JOIN adds the difference
 * back and lets it die out over `joinMs`: a correction d(t) = dv x
 * phi(t), phi(x) = x (1 - x/T)^3, with phi(0) = 0, phi'(0) = 1 and
 * phi(T) = phi'(T) = phi''(T) = 0, so position and velocity are
 * continuous at both ends and the acceleration at its end (the plan's Hermite join, DEC-CF-1b). Its size follows the velocity
 * MISMATCH, small in the common case (a slow hold turning into a fast
 * flight); a cross-fade of the two flights followed how far they drifted
 * apart and dipped the speed by 14-26 % there (measured, CF3). A replan
 * within a join starts from the joined camera, so joins nest; the old
 * flight is never evaluated again.
 *
 * `clearedLandingM` raises a landing until the camera, wherever the landing
 * reaches it (half a metre per metre), clears the ground under it (cold review finding 11): at 45 degrees the
 * camera lands about one landing altitude behind the target, over ground
 * the target's own height does not describe.
 *
 * @see flight-replan.ts.md
 */

import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import type { OrbitPose } from "./globe-camera.js";
import { obliqueCamera } from "./globe-dive.js";
import {
  FLIGHT_PATH,
  flightAt,
  planFlight,
  rampCruiseShare,
  viewFromCamera,
  type FlightFrame,
  type FlightPath,
  type FlightStart,
} from "./flight-path.js";

/**
 * A sample the landing moves by less than this per metre is out of the
 * landing's reach (the start, a plateau under it). Half a metre per metre
 * (R1 milestone review): on the travel curve a landing scales the whole
 * descent a little, and at 0.05 ground under the early path read as a
 * shortfall over a small sensitivity (a 9,800 m ridge under a 10 km start
 * raised a 2 km landing to 6 km); a final-approach window instead missed
 * ridges just before the dive.
 */
const MIN_LANDING_SENSITIVITY = 0.5;

export const FLIGHT_REPLAN = Object.freeze({
  /** How long a replan's velocity correction takes to die out, ms. */
  joinMs: 1_500,
  /** The least height over the ground under the camera, m (the lab's). */
  clearanceM: 300,
  /** A replanned flight lasts at least this, ms... */
  minDurationMs: 2_000,
  /** ...and at most this (one replanned path's length, as DEC-CF-5's cap), ms. */
  maxDurationMs: 60_000,
  /** Rounds of `clearedLandingM`'s raise (each samples the whole flight). */
  clearanceRounds: 6,
  /**
   * Samples per round of `clearedLandingM`: at 240 (one every 62 ms of a
   * 15 s flight) a ridge 2 km wide was cleared by 275 m, not 300 (the R1
   * milestone review's ridges); 960 clears it.
   */
  clearanceSamples: 960,
});

/**
 * A replan's velocity correction: the camera's old velocity minus the new
 * path's first one, as a rate of the altitude's logarithm and a ground
 * velocity (a rotation axis and radians per ms).
 */
interface FlightJoin {
  readonly atMs: number;
  /** How long the correction lasts: `joinMs`, or the flight if shorter. */
  readonly spanMs: number;
  readonly lnAltitudePerMs: number;
  /**
   * The lowest the correction may take the camera, m: the lower of its
   * altitude at the replan and the new landing.
   */
  readonly floorM: number;
  readonly axis: THREE.Vector3 | null;
  readonly radiansPerMs: number;
}

/** A flight: its current path, and the join of its last replan (or null). */
export interface Flight {
  readonly ellipsoid: Ellipsoid;
  readonly path: FlightPath;
  /** The clock time the path's time 0 is at, ms. */
  readonly startedAtMs: number;
  /** When the flight lands, ms. */
  readonly endsAtMs: number;
  readonly join: FlightJoin | null;
}

type PlanOptions = Parameters<typeof planFlight>[3];

/** A flight from `start`, its time 0 at `atMs` (see `planFlight`). */
export function startFlight(
  ellipsoid: Ellipsoid,
  start: FlightStart,
  target: OrbitPose,
  options: PlanOptions,
  atMs: number,
): Flight {
  if (!Number.isFinite(atMs)) {
    throw new RangeError(`the start time must be finite, got ${atMs}`);
  }
  const path = planFlight(ellipsoid, start, target, options);
  return {
    ellipsoid,
    path,
    startedAtMs: atMs,
    endsAtMs: atMs + path.durationMs,
    join: null,
  };
}

/**
 * The join's shape: x (1 - x/T)^3 for x in [0, T], 0 outside (ms): slope
 * 1 at 0, and value, slope and curvature 0 at T, so the correction ends
 * without a jump in the acceleration either (CF2 review finding 8: the
 * squared form left one of 2 dv / T).
 */
function joinShape(x: number, t: number): number {
  if (!(x > 0) || x >= t) return 0;
  return x * (1 - x / t) ** 3;
}

/** The flight's frame at clock time `nowMs`, with its replan's join. */
export function flightFrameAt(flight: Flight, nowMs: number): FlightFrame {
  if (Number.isNaN(nowMs)) throw new RangeError("the time must be a number");
  // The end by the flight's own clock: a fractional duration made
  // (start + D) - start a hair short of D, and the last frame never done.
  const own = flightAt(
    flight.path,
    nowMs >= flight.endsAtMs
      ? flight.path.durationMs
      : nowMs - flight.startedAtMs,
  );
  const join = flight.join;
  const phi = join ? joinShape(nowMs - join.atMs, join.spanMs) : 0;
  if (!join || phi === 0) return own;
  // The join moves the CAMERA; the view is built from it (moving the view
  // and placing the camera behind it at a corrected altitude slid the
  // camera sideways).
  const angle = join.radiansPerMs * phi;
  const turn = (v: THREE.Vector3) =>
    join.axis ? v.clone().applyAxisAngle(join.axis, angle) : v.clone();
  const camera = turn(own.camera);
  const heading = turn(own.heading).projectOnPlane(camera).normalize();
  // Never below the replan's floor: the old descent carried into a nearly
  // level path took the camera up to 0.31 m under its landing (2026-10-08).
  const altitudeM = Math.max(
    own.altitudeM * Math.exp(join.lnAltitudePerMs * phi),
    Math.min(own.altitudeM, join.floorM),
  );
  const view = viewFromCamera(
    flight.ellipsoid,
    camera,
    heading,
    altitudeM,
    own.pitchDeg,
  );
  return {
    ...own,
    centre: view.centre,
    up: view.up,
    camera,
    heading,
    altitudeM,
    arcRad: view.centre.angleTo(flight.path.target),
  };
}

/** The camera on a frame: `obliqueCamera`, with the path's start tilt. */
function cameraOn(
  ellipsoid: Ellipsoid,
  path: FlightPath,
  f: FlightFrame,
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const camera = obliqueCamera(
    ellipsoid,
    { direction: f.centre, up: f.up },
    f.altitudeM,
    f.pitchDeg,
  );
  const offset = new THREE.Quaternion().slerp(path.startOffset, f.startWeight);
  return {
    position: camera.position,
    quaternion: camera.quaternion.multiply(offset),
  };
}

/** The camera at clock time `nowMs`, on the joined frame. */
export function flightCameraAt(
  flight: Flight,
  nowMs: number,
): {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  altitudeM: number;
  done: boolean;
} {
  const f = flightFrameAt(flight, nowMs);
  return {
    ...cameraOn(flight.ellipsoid, flight.path, f),
    altitudeM: f.altitudeM,
    done: f.done,
  };
}

/**
 * The join from the camera's velocity at `atMs` (a backward difference of
 * the old flight) to the new path's first one (a forward difference).
 */
function joinFrom(old: Flight, atMs: number, path: FlightPath): FlightJoin {
  // Backward on the old flight, forward on the new, each from the replan's
  // own point, with steps small against what each has left.
  const dtOld = differenceStepMs(old, atMs);
  const p0 = flightCameraAt(old, atMs).position;
  const vOld = p0
    .clone()
    .sub(flightCameraAt(old, atMs - dtOld).position)
    .divideScalar(dtOld);
  const dtNew = Math.max(1e-4, Math.min(1, path.durationMs / 1000));
  const newAt = (t: number) =>
    cameraOn(old.ellipsoid, path, flightAt(path, t)).position;
  const vNew = newAt(dtNew).sub(newAt(0)).divideScalar(dtNew);
  const dv = vOld.sub(vNew);
  const radial = p0.clone().normalize();
  const dRadial = dv.dot(radial);
  const ground = dv.clone().addScaledVector(radial, -dRadial);
  const axis = new THREE.Vector3().crossVectors(radial, ground);
  return {
    atMs,
    // Never past the landing: a join that outlived a short flight held the
    // landed camera below its landing (measured up to 1.6 %).
    spanMs: Math.min(FLIGHT_REPLAN.joinMs, path.durationMs),
    lnAltitudePerMs: dRadial / flightAt(path, 0).altitudeM,
    floorM: Math.min(flightAt(path, 0).altitudeM, path.landingM),
    axis: axis.length() > 1e-15 ? axis.normalize() : null,
    radiansPerMs: ground.length() / p0.length(),
  };
}

/**
 * The camera's speed at `nowMs` by the flight's measure (geodesic length
 * per ms: sqrt((d ln h)^2 + (ground / h)^2) / dt), by a backward difference.
 */
function speedAt(flight: Flight, nowMs: number): number {
  const dt = differenceStepMs(flight, nowMs);
  const a = flightCameraAt(flight, nowMs - dt);
  const b = flightCameraAt(flight, nowMs);
  const da = a.position.clone().normalize();
  const db = b.position.clone().normalize();
  const ground =
    2 * Math.asin(Math.min(1, da.distanceTo(db) / 2)) * FLIGHT_PATH.radiusM;
  const h = (a.altitudeM + b.altitudeM) / 2;
  return Math.hypot(Math.log(b.altitudeM / a.altitudeM), ground / h) / dt;
}

/**
 * The step for a velocity by a backward difference at `nowMs`: small
 * against the time the flight has left (a replan in its last milliseconds
 * brakes hard, and a 1 ms difference misread that by about 5 %), never
 * past its start, and above the positions' rounding (1e-4 ms moves a
 * camera at 1 m/ms by 0.1 mm, against 1e-9 m of float64 at the Earth's
 * radius).
 */
function differenceStepMs(flight: Flight, nowMs: number): number {
  const left = Math.max(flight.endsAtMs - nowMs, 0);
  const since = Math.max(nowMs - flight.startedAtMs, 0);
  return Math.max(1e-4, Math.min(1, left / 1000, since > 0 ? since : 1));
}

/** The camera as a flight start: direction, heading, distance, view, tilt. */
function startFrom(flight: Flight, nowMs: number): FlightStart {
  const f = flightFrameAt(flight, nowMs);
  const cam = flightCameraAt(flight, nowMs);
  const direction = cam.position.clone().normalize();
  // The heading at the camera: towards the view's centre, or (looking
  // straight down) the frame's up.
  const ahead = f.centre.clone().sub(direction).projectOnPlane(direction);
  const up =
    ahead.length() > 1e-9
      ? ahead.normalize()
      : f.up.clone().projectOnPlane(direction).normalize();
  return {
    pose: { direction, up },
    distanceM: cam.position.length(),
    quaternion: cam.quaternion,
    pitchDeg: Math.min(90, Math.max(1e-6, f.pitchDeg)),
  };
}

/**
 * The flight replanned at clock time `atMs` to `target` and
 * `options.landingM`, from the camera as it is. Without a duration the
 * replanned path's cruise matches the camera's speed (within
 * `minDurationMs`-`maxDurationMs`); from rest (after the landing) it takes
 * the default duration. RangeError for a time before the flight began.
 */
export function retargetFlight(
  flight: Flight,
  atMs: number,
  target: OrbitPose,
  options: PlanOptions,
): Flight {
  if (!(Number.isFinite(atMs) && atMs >= flight.startedAtMs)) {
    throw new RangeError(
      `a replan must come after the flight began (${flight.startedAtMs} ms), got ${atMs}`,
    );
  }
  const landed = atMs >= flight.endsAtMs;
  const start = startFrom(flight, atMs);
  const speed = landed ? 0 : speedAt(flight, atMs);
  const timing = replanTiming(flight, atMs, start, target, options, speed);
  const path = planFlight(flight.ellipsoid, start, target, {
    ...options,
    durationMs: options.durationMs ?? timing.durationMs,
    rampMs: timing.rampMs,
    rampFromShare: timing.rampFromShare,
    brake: timing.brake ?? false,
    ...(timing.settleLength === undefined
      ? {}
      : { settleLength: timing.settleLength }),
    startSpeed: speed,
  });
  return {
    ellipsoid: flight.ellipsoid,
    path,
    startedAtMs: atMs,
    endsAtMs: atMs + path.durationMs,
    join: landed ? null : joinFrom(flight, atMs, path),
  };
}

/**
 * The replanned flight's duration (CF2 review finding 1).
 * - Its cruise runs at the larger of the OLD flight's cruise (so a replan
 *   that changes nothing changes nothing, in the press's ramp included)
 *   and a fresh flight's from here (L + settle over the default
 *   duration), so a replan out of the hold's slow cruise flies on at a
 *   normal pace (found by CF3: copying the instant speed crawled at 0.16
 *   e-folds per second, about a minute from 8,500 km).
 * - From the clock's formula v = (L + settle - s0 x ramp / 2) / (D - ramp
 *   / 2): D = (L + settle - s0 x ramp / 2) / v + ramp / 2.
 * - A path too short to reach that cruise from the camera's speed s0 (a
 *   replan in the final settle) decelerates from s0 instead, over D = 2L /
 *   s0, as a constant braking would: it re-accelerated and settled again,
 *   and dipped up to 7.6 m under a 1 km landing (measured).
 * - The ramp to that cruise: the old flight's own remaining ramp when it is
 *   still ramping to the same cruise (so a replan in the press's ramp
 *   changes nothing), else a ramp as long as the speed gap's share of
 *   `FLIGHT_PATH.rampMs` (none when the speeds already match).
 * - Clamped to `maxDurationMs`; at least `minDurationMs` only when cruising
 *   (a short braking keeps its own length, or the start speed's cap would
 *   cut it, finding 6).
 */
function replanTiming(
  flight: Flight,
  atMs: number,
  start: FlightStart,
  target: OrbitPose,
  options: PlanOptions,
  speed: number,
): {
  durationMs: number;
  rampMs: number;
  rampFromShare: number;
  brake?: boolean;
  settleLength?: number;
} {
  const probe = planFlight(flight.ellipsoid, start, target, options);
  const length = probe.geodesicLength;
  // The same destination (a new landing at most): its settle keeps the old
  // flight's length, so it starts where the old one would have (CF3 review
  // finding 3); a new place settles as a fresh flight would.
  const sameDestination =
    flight.path.target.distanceTo(target.direction.clone().normalize()) *
      FLIGHT_PATH.radiusM <
    Math.max(options.landingM, 1_000);
  const settle =
    sameDestination && flight.path.settleLength > 0
      ? Math.min(flight.path.settleLength, length)
      : Math.min(
          Math.log(options.settleFactor ?? FLIGHT_PATH.settleFactor),
          length / 3,
        );
  const fresh = (length + settle) / FLIGHT_PATH.durationMs;
  const v = Math.max(flight.path.cruiseSpeed, fresh);
  const ramp = replanRamp(flight, atMs, speed, v);
  const c = rampCruiseShare(ramp.rampFromShare);
  const cruiseLength =
    length - ramp.rampMs * (speed * (1 - c) + v * c) - settle;
  // Braking on only towards the same destination (CF3 review finding 2: a
  // new place reached from the old settle, a fix late in the hold, crawled
  // for up to 60 s).
  const settling =
    sameDestination &&
    (flight.path.cruise === null ||
      atMs >= flight.startedAtMs + flight.path.cruise.toMs);
  if (speed > 0 && (settling || cruiseLength < 0)) {
    // Braking on from the camera's speed, as the old flight was: a Hermite
    // from that speed to rest over 2L / s0 (constant braking's length).
    const braking = (2 * length) / speed;
    return {
      durationMs: Math.min(FLIGHT_REPLAN.maxDurationMs, Math.max(1, braking)),
      rampMs: 0,
      rampFromShare: 0,
      brake: true,
    };
  }
  const d =
    (length + settle - speed * ramp.rampMs * (1 - c)) / v +
    ramp.rampMs * (1 - c);
  return {
    durationMs: Math.min(
      FLIGHT_REPLAN.maxDurationMs,
      Math.max(FLIGHT_REPLAN.minDurationMs, d),
    ),
    ...ramp,
    ...(sameDestination ? { settleLength: settle } : {}),
  };
}

/**
 * The ramp from the camera's speed to the cruise `v` (see `replanTiming`):
 * the old ramp's own tail while it is still ramping to the same cruise,
 * else the speed gap's share of a full ramp.
 */
function replanRamp(
  flight: Flight,
  atMs: number,
  speed: number,
  v: number,
): { rampMs: number; rampFromShare: number } {
  const span = flight.path.cruise?.fromMs ?? 0;
  const elapsed = atMs - flight.startedAtMs;
  if (elapsed < span && v === flight.path.cruiseSpeed) {
    const x0 = flight.path.rampFromShare;
    return {
      rampMs: span - elapsed,
      rampFromShare: x0 + ((1 - x0) * elapsed) / span,
    };
  }
  if (!(v > 0)) return { rampMs: 0, rampFromShare: 0 };
  return {
    rampMs: FLIGHT_PATH.rampMs * Math.min(1, Math.abs(v - speed) / v),
    rampFromShare: 0,
  };
}

/**
 * The least landing (at or above `options.landingM`) at which the camera's
 * flight from `start`, wherever the landing reaches it (it moves there by
 * half a metre per metre or more), stays `clearanceM` over `groundAt` (the
 * ground's height under a direction, m; null where it is not known yet,
 * which is ignored). Raises the landing by the worst shortfall, replans,
 * and repeats, `clearanceRounds` times at most.
 */
export function clearedLandingM(
  ellipsoid: Ellipsoid,
  start: FlightStart,
  target: OrbitPose,
  options: PlanOptions,
  groundAt: (direction: THREE.Vector3) => number | null,
): number {
  let landingM = options.landingM;
  for (let round = 0; round < FLIGHT_REPLAN.clearanceRounds; round++) {
    const raise = landingRaiseM(
      ellipsoid,
      start,
      target,
      options,
      landingM,
      groundAt,
    );
    if (raise <= 0) return landingM;
    landingM += raise;
  }
  return landingM;
}

/**
 * The landing raise one round of `clearedLandingM` needs: the worst
 * shortfall under the camera divided by how much the camera there rises
 * with the landing (a second plan 1 m higher), counting only samples the
 * landing moves (CF2 review finding 4: a start already too low over a
 * plateau, which no landing changes, was added again every round).
 */
function landingRaiseM(
  ellipsoid: Ellipsoid,
  start: FlightStart,
  target: OrbitPose,
  options: PlanOptions,
  landingM: number,
  groundAt: (direction: THREE.Vector3) => number | null,
): number {
  const path = planFlight(ellipsoid, start, target, { ...options, landingM });
  const higher = planFlight(ellipsoid, start, target, {
    ...options,
    landingM: landingM + 1,
  });
  let raise = 0;
  for (let i = 0; i <= FLIGHT_REPLAN.clearanceSamples; i++) {
    const share = i / FLIGHT_REPLAN.clearanceSamples;
    const f = flightAt(path, share * path.durationMs);
    const g = flightAt(higher, share * higher.durationMs);
    const sensitivity = g.altitudeM - f.altitudeM;
    if (!(sensitivity > MIN_LANDING_SENSITIVITY)) continue;
    const ground = groundAt(
      obliqueCamera(
        ellipsoid,
        { direction: f.centre, up: f.up },
        f.altitudeM,
        f.pitchDeg,
      ).position.normalize(),
    );
    if (ground === null || !Number.isFinite(ground)) continue;
    const short = ground + FLIGHT_REPLAN.clearanceM - f.altitudeM;
    raise = Math.max(raise, short / sensitivity);
  }
  return raise;
}
