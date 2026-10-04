/**
 * The pin's dive (round-2 plan 2026-09-26-2055 M3g; the owner: "turns the
 * globe towards me and zooms in over about 15 s"): from wherever the camera
 * is, turn to the target and descend to the hand-over altitude. Pure: time
 * in; a turn fraction and an altitude (`diveAt`), or the camera's position
 * and rotation (`planDive`, `diveStep`), out.
 *
 * @see globe-dive.ts.md
 */

import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import { smoothstep, turnPose, type OrbitPose } from "./globe-camera.js";
import { GLOBE_FLIGHT, pitchAtDeg } from "./globe-flight.js";

export const GLOBE_DIVE = {
  /** The whole dive, turn and descent (the owner's "about 15 s"). */
  durationMs: 15_000,
  /**
   * Where the city takes over: 150 km, the least soft of the round-2 sweep
   * {20, 50, 150} km with the committed z4 imagery (round-2 §6 Q1).
   */
  handOverAltitudeM: 150_000,
  /**
   * The share of the dive spent turning towards the target; the descent
   * runs through the whole dive, so the turn is done while the camera is
   * still high and the last stretch only descends.
   */
  turnShare: 0.4,
} as const;

/** One instant of a dive. */
export interface DiveFrame {
  /** The eased fraction of the turn, 0 to 1 (for `turnPose`). */
  readonly turnT: number;
  /** The camera's height above the target's surface point, metres. */
  readonly altitudeM: number;
  /** Whether the dive has reached its end. */
  readonly done: boolean;
}

/**
 * The dive `elapsedMs` after it began. The altitude moves from
 * `fromAltitudeM` to `toAltitudeM` evenly in its logarithm (every halving
 * takes as long as the one before), eased at both ends by `smoothstep`, so
 * it never reverses and a descent reads as a steady fall towards the
 * ground. The turn runs over the first `turnShare` of the dive, eased. The
 * ends are exact and held outside [0, durationMs].
 *
 * RangeError for a duration or an altitude that is not a positive number.
 */
export function diveAt(
  elapsedMs: number,
  options: {
    readonly durationMs: number;
    readonly fromAltitudeM: number;
    readonly toAltitudeM: number;
    readonly turnShare?: number;
  },
): DiveFrame {
  const { durationMs, fromAltitudeM, toAltitudeM } = options;
  const turnShare = options.turnShare ?? GLOBE_DIVE.turnShare;
  for (const [name, value] of [
    ["durationMs", durationMs],
    ["fromAltitudeM", fromAltitudeM],
    ["toAltitudeM", toAltitudeM],
  ] as const) {
    if (!(value > 0 && Number.isFinite(value))) {
      throw new RangeError(`${name} must be a positive number, got ${value}`);
    }
  }
  if (!(turnShare > 0 && turnShare <= 1)) {
    throw new RangeError(`turnShare must be in (0, 1], got ${turnShare}`);
  }
  const t = Math.min(Math.max(elapsedMs / durationMs, 0), 1);
  if (t >= 1) return { turnT: 1, altitudeM: toAltitudeM, done: true };
  if (t <= 0) return { turnT: 0, altitudeM: fromAltitudeM, done: false };
  const eased = smoothstep(t);
  return {
    turnT: smoothstep(t / turnShare),
    altitudeM: fromAltitudeM * (toAltitudeM / fromAltitudeM) ** eased,
    done: false,
  };
}

/**
 * The distance from the centre to the ellipsoid's surface along a
 * direction (any length, not zero): the geocentric ray's surface point, the
 * one `orbitPose` puts at the centre of the frame.
 */
export function surfaceRadiusAlong(
  ellipsoid: Ellipsoid,
  direction: THREE.Vector3,
): number {
  const { x: a, y: b, z: c } = ellipsoid.radius;
  const d = direction.clone().normalize();
  return 1 / Math.hypot(d.x / a, d.y / b, d.z / c);
}

const ORIGIN = new THREE.Vector3();
const lookAtMatrix = new THREE.Matrix4();

/**
 * The rotation a camera has on an orbit pose, looking at the centre (what
 * `applyOrbitPose` sets through three's `lookAt`).
 */
export function orbitQuaternion(
  pose: OrbitPose,
  target: THREE.Quaternion,
): THREE.Quaternion {
  lookAtMatrix.lookAt(pose.direction, ORIGIN, pose.up);
  return target.setFromRotationMatrix(lookAtMatrix);
}

/** Where the camera is when a dive begins. */
export interface DiveStart {
  /** Its orbit pose: the direction from the centre and the screen's up. */
  readonly pose: OrbitPose;
  /** Its distance from the centre, metres. */
  readonly distanceM: number;
  /** Its rotation (the controls may have tilted it off the orbit view). */
  readonly quaternion: THREE.Quaternion;
}

/** A planned dive, for `diveStep`. */
export interface Dive {
  readonly ellipsoid: Ellipsoid;
  readonly from: OrbitPose;
  readonly to: OrbitPose;
  /** The start's rotation relative to its own orbit view (identity if untilted). */
  readonly startOffset: THREE.Quaternion;
  readonly durationMs: number;
  readonly fromAltitudeM: number;
  readonly toAltitudeM: number;
  /** The pitch law's low pitch (round-5 plan §3.5; 90 flies the old nadir dive). */
  readonly pitchLowDeg: number;
}

/** The share of the dive over which a tilted start turns to the orbit view. */
const OFFSET_FADE_SHARE = 0.2;

/**
 * A dive from `start` to `target` (an orbit pose), ending `toAltitudeM`
 * above the target's surface point. The start's altitude is its own height
 * above the surface along its own direction (not above the target's
 * surface radius, which differs by up to 21 km between a pole and the
 * equator). RangeError as `diveAt`.
 */
export function planDive(
  ellipsoid: Ellipsoid,
  start: DiveStart,
  target: OrbitPose,
  options: {
    readonly durationMs: number;
    readonly toAltitudeM: number;
    readonly pitchLowDeg?: number;
  },
): Dive {
  const startOrbit = orbitQuaternion(start.pose, new THREE.Quaternion());
  const dive: Dive = {
    ellipsoid,
    from: start.pose,
    to: target,
    startOffset: startOrbit.invert().multiply(start.quaternion),
    durationMs: options.durationMs,
    fromAltitudeM: Math.max(
      1,
      start.distanceM - surfaceRadiusAlong(ellipsoid, start.pose.direction),
    ),
    toAltitudeM: options.toAltitudeM,
    pitchLowDeg: options.pitchLowDeg ?? GLOBE_FLIGHT.pitchLowDeg,
  };
  diveAt(0, dive); // validates the numbers
  pitchAtDeg(0, { pitchLowDeg: dive.pitchLowDeg }); // and the pitch
  return dive;
}

/**
 * The camera `elapsedMs` into a dive: on the turned orbit pose, at the
 * dive's altitude above the surface along its own direction, looking at
 * the centre, with the start's own tilt (its offset from its orbit view)
 * fading out over the first fifth. So an untilted start looks at the
 * centre all the way, and a tilted one does not snap.
 */
export function diveStep(
  dive: Dive,
  elapsedMs: number,
): {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  altitudeM: number;
  done: boolean;
} {
  const frame = diveAt(elapsedMs, dive);
  const pose = turnPose(dive.from, dive.to, frame.turnT);
  const weight =
    1 - smoothstep(elapsedMs / (OFFSET_FADE_SHARE * dive.durationMs));
  const offset = new THREE.Quaternion().slerp(dive.startOffset, weight);
  // The pitch law, eased in over the same first fifth, so a start low
  // enough to be below 90 degrees still begins exactly where the camera is.
  const law = pitchAtDeg(frame.altitudeM, { pitchLowDeg: dive.pitchLowDeg });
  const pitch = 90 + (law - 90) * (1 - weight);
  const camera = obliqueCamera(dive.ellipsoid, pose, frame.altitudeM, pitch);
  return {
    position: camera.position,
    quaternion: camera.quaternion.multiply(offset),
    altitudeM: frame.altitudeM,
    done: frame.done,
  };
}

/**
 * A camera `altitudeM` above the ground point under `pose` (its surface
 * radius plus the altitude, from the centre), looking at that ground point
 * with a depression of `pitchDeg` below its local horizontal, from the
 * south (round-5 plan §3.5): 90 degrees is the orbit view straight down;
 * lower pitches move the camera back along the meridian by the angle the
 * triangle centre-camera-ground gives. The screen's up is the pose's north.
 */
export function obliqueCamera(
  ellipsoid: Ellipsoid,
  pose: OrbitPose,
  altitudeM: number,
  pitchDeg: number,
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const d = pose.direction.clone().normalize();
  const rs = surfaceRadiusAlong(ellipsoid, d);
  const ground = d.clone().multiplyScalar(rs);
  const gamma = ((90 - pitchDeg) * Math.PI) / 180;
  const theta =
    gamma > 1e-12
      ? Math.asin(Math.min(1, ((rs + altitudeM) / rs) * Math.sin(gamma))) -
        gamma
      : 0;
  const position = d
    .clone()
    .multiplyScalar(Math.cos(theta))
    .addScaledVector(pose.up, -Math.sin(theta))
    .normalize()
    .multiplyScalar(rs + altitudeM);
  lookAtMatrix.lookAt(position, ground, pose.up);
  return {
    position,
    quaternion: new THREE.Quaternion().setFromRotationMatrix(lookAtMatrix),
  };
}
