/**
 * The flight's replans (continuous-flight plan 2026-10-07-0941, CF2): a
 * changed target (the device's fix after the press, a new link) or a
 * changed landing (the target's height tile arrives) replans the flight
 * from the camera's current state, without a jump or a kink. Pure: a
 * `Flight` value in, a new one out; frames and cameras by time.
 *
 * A replan starts a new `flight-path` from the camera as it is (its
 * direction, altitude, view and tilt), at its current speed, with a
 * duration that makes its cruise that same speed, so the speed carries
 * through. The old flight's frame then cross-fades into the new one over
 * `blendMs` with a smoothstep weight: both frames are equal at the replan
 * and the weight's slope is zero at both ends, so the camera's position
 * and velocity are continuous (the plan's Hermite join, DEC-CF-1b, as the
 * smallest mechanism that also bends the direction). A replan within a
 * blend nests: the frame it starts from is itself a blend.
 *
 * `clearedLandingM` raises a landing until the camera's whole approach
 * clears the ground under it (cold review finding 11): at 45 degrees the
 * camera lands about one landing altitude behind the target, over ground
 * the target's own height does not describe.
 *
 * @see flight-replan.ts.md
 */

import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import type { OrbitPose } from "./globe-camera.js";
import { smoothstep } from "./globe-ease.js";
import { obliqueCamera } from "./globe-dive.js";
import {
  FLIGHT_PATH,
  flightAt,
  planFlight,
  type FlightFrame,
  type FlightPath,
  type FlightStart,
} from "./flight-path.js";

export const FLIGHT_REPLAN = Object.freeze({
  /** The cross-fade from the old flight to the replanned one, ms. */
  blendMs: 1_500,
  /** The least height over the ground under the camera, m (the lab's). */
  clearanceM: 300,
  /** A replanned flight lasts at least this, ms... */
  minDurationMs: 2_000,
  /** ...and at most this (DEC-CF-5's safety cap), ms. */
  maxDurationMs: 60_000,
  /** Rounds of `clearedLandingM`'s raise (each samples the whole flight). */
  clearanceRounds: 6,
  /** Samples per round of `clearedLandingM`. */
  clearanceSamples: 240,
});

/** A flight: its current path, and the one it is still blending from. */
export interface Flight {
  readonly ellipsoid: Ellipsoid;
  readonly path: FlightPath;
  /** The clock time the path's time 0 is at, ms. */
  readonly startedAtMs: number;
  /** When the flight lands, ms. */
  readonly endsAtMs: number;
  /** The flight replanned from, faded out until `untilMs`; null if none. */
  readonly previous: {
    readonly flight: Flight;
    readonly untilMs: number;
  } | null;
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
    previous: null,
  };
}

/** Spherical interpolation of two unit vectors. */
function slerpUnit(
  a: THREE.Vector3,
  b: THREE.Vector3,
  w: number,
): THREE.Vector3 {
  const angle = a.angleTo(b);
  if (angle < 1e-12) return a.clone();
  const axis = new THREE.Vector3().crossVectors(a, b);
  if (axis.length() < 1e-15) return w < 0.5 ? a.clone() : b.clone();
  return a.clone().applyAxisAngle(axis.normalize(), angle * w);
}

/** The blend's weight at `nowMs`, 0 at the replan to 1 at its end. */
function blendWeight(flight: Flight, nowMs: number): number {
  if (!flight.previous) return 1;
  const span = FLIGHT_REPLAN.blendMs;
  return smoothstep((nowMs - (flight.previous.untilMs - span)) / span);
}

/** The flight's frame at clock time `nowMs`, blended across a replan. */
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
  const w = blendWeight(flight, nowMs);
  if (!flight.previous || w >= 1) return own;
  const old = flightFrameAt(flight.previous.flight, nowMs);
  const centre = slerpUnit(old.centre, own.centre, w);
  const up = slerpUnit(old.up, own.up, w).projectOnPlane(centre).normalize();
  return {
    centre,
    up,
    camera: slerpUnit(old.camera, own.camera, w),
    altitudeM: Math.exp(
      Math.log(old.altitudeM) * (1 - w) + Math.log(own.altitudeM) * w,
    ),
    arcRad: centre.angleTo(flight.path.target),
    pitchDeg: old.pitchDeg * (1 - w) + own.pitchDeg * w,
    startWeight: own.startWeight,
    done: own.done,
  };
}

/** The tilt offset of a flight at `nowMs`, blended as its frame. */
function offsetAt(flight: Flight, nowMs: number): THREE.Quaternion {
  const own = new THREE.Quaternion().slerp(
    flight.path.startOffset,
    flightAt(flight.path, nowMs - flight.startedAtMs).startWeight,
  );
  const w = blendWeight(flight, nowMs);
  if (!flight.previous || w >= 1) return own;
  return offsetAt(flight.previous.flight, nowMs).slerp(own, w);
}

/** The camera at clock time `nowMs`: `obliqueCamera` on the blended frame. */
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
  const camera = obliqueCamera(
    flight.ellipsoid,
    { direction: f.centre, up: f.up },
    f.altitudeM,
    f.pitchDeg,
  );
  return {
    position: camera.position,
    quaternion: camera.quaternion.multiply(offsetAt(flight, nowMs)),
    altitudeM: f.altitudeM,
    done: f.done,
  };
}

/**
 * The camera's speed at `nowMs` by the flight's measure (geodesic length
 * per ms: sqrt((d ln h)^2 + (ground / h)^2) / dt), by a central difference.
 */
function speedAt(flight: Flight, nowMs: number): number {
  const dt = 1;
  const a = flightCameraAt(flight, nowMs - dt);
  const b = flightCameraAt(flight, nowMs + dt);
  const da = a.position.clone().normalize();
  const db = b.position.clone().normalize();
  const ground =
    2 * Math.asin(Math.min(1, da.distanceTo(db) / 2)) * FLIGHT_PATH.radiusM;
  const h = (a.altitudeM + b.altitudeM) / 2;
  return Math.hypot(Math.log(b.altitudeM / a.altitudeM), ground / h) / (2 * dt);
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
  if (!(atMs >= flight.startedAtMs)) {
    throw new RangeError(
      `a replan must come after the flight began (${flight.startedAtMs} ms), got ${atMs}`,
    );
  }
  const landed = atMs >= flight.endsAtMs;
  const start = startFrom(flight, atMs);
  const speed = landed ? 0 : speedAt(flight, atMs);
  const durationMs =
    options.durationMs ??
    matchedDurationMs(flight, start, target, options, speed);
  const path = planFlight(flight.ellipsoid, start, target, {
    ...options,
    durationMs,
    startSpeed: speed,
  });
  return {
    ellipsoid: flight.ellipsoid,
    path,
    startedAtMs: atMs,
    endsAtMs: atMs + path.durationMs,
    previous: landed ? null : { flight, untilMs: atMs + FLIGHT_REPLAN.blendMs },
  };
}

/**
 * The duration whose cruise speed is `speed`: from the clock's formula
 * v = (L + settle - speed x ramp / 2) / (D - ramp / 2) with v = speed,
 * D = (L + settle) / speed (the ramp then changes nothing). Clamped.
 */
function matchedDurationMs(
  flight: Flight,
  start: FlightStart,
  target: OrbitPose,
  options: PlanOptions,
  speed: number,
): number {
  if (!(speed > 0)) return FLIGHT_PATH.durationMs;
  const probe = planFlight(flight.ellipsoid, start, target, options);
  const settle = Math.min(
    Math.log(options.settleFactor ?? FLIGHT_PATH.settleFactor),
    probe.geodesicLength / 3,
  );
  const d = (probe.geodesicLength + settle) / speed;
  return Math.min(
    FLIGHT_REPLAN.maxDurationMs,
    Math.max(FLIGHT_REPLAN.minDurationMs, d),
  );
}

/**
 * The least landing (at or above `options.landingM`) at which the camera's
 * whole flight from `start` stays `clearanceM` over `groundAt` (the
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
    const path = planFlight(ellipsoid, start, target, { ...options, landingM });
    let shortfall = 0;
    for (let i = 0; i <= FLIGHT_REPLAN.clearanceSamples; i++) {
      const t = (path.durationMs * i) / FLIGHT_REPLAN.clearanceSamples;
      const f = flightAt(path, t);
      const ground = groundAt(
        obliqueCamera(
          ellipsoid,
          { direction: f.centre, up: f.up },
          f.altitudeM,
          f.pitchDeg,
        ).position.normalize(),
      );
      if (ground === null || !Number.isFinite(ground)) continue;
      shortfall = Math.max(
        shortfall,
        ground + FLIGHT_REPLAN.clearanceM - f.altitudeM,
      );
    }
    if (shortfall <= 0) return landingM;
    landingM += shortfall;
  }
  return landingM;
}
