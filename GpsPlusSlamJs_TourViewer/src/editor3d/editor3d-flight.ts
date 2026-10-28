/**
 * The 3D editor's camera flights, pure: a click on a card flies the orbit
 * to a station or an item, Frame fits the tour, the compass turns north
 * up, plus and minus zoom, Top view looks straight down. Each is a short
 * flight from the orbit's pose now to a goal pose:
 *
 * - the centre moves in a straight line, the distance on a log scale,
 *   the tilt evenly and the turn the short way round, all on one
 *   ease-in-out curve, so the flight starts where the camera is and ends
 *   exactly at its goal;
 * - a station is framed by its radius, an item or a code brought to a
 *   working distance (at least three frames of it, at most 60 m), the
 *   turn kept and the tilt capped at about 70 degrees, so a flight never
 *   ends looking along the ground;
 * - every goal stays inside the orbit's limits (`EDITOR_CAMERA`).
 *
 * @see editor3d-flight.ts.md
 */
import * as THREE from "three";

import { EDITOR_CAMERA } from "./editor3d-camera.js";

/** An orbit's pose: its centre, and the camera's distance, tilt from
 *  straight down and turn around it (x east, z south: azimuth 0 puts the
 *  camera south of its centre, looking north). */
export interface OrbitPose {
  readonly target: THREE.Vector3;
  readonly distanceM: number;
  readonly polarRad: number;
  readonly azimuthRad: number;
}

/** The flights' timings and rules. */
export const FLIGHT = Object.freeze({
  /** A flight never ends flatter than this (about 70 degrees of tilt). */
  flatCapRad: Math.acos(0.35),
  /** Top view: as good as straight down, still with a turn. */
  topPolarRad: 0.0006,
  /** The tilt Top view goes back to when none was kept. */
  untopPolarRad: 0.83,
  /** An item or a code is never flown to from farther than this (m). */
  itemMaxM: 60,
  /** The nearest a frame brings the camera (m). */
  minFrameM: 4,
  /** A station's frame: its radius and a margin. */
  stationMargin: 1.05,
  /** One zoom step's factor. */
  zoomStep: 1.6,
  flyMs: 700,
  frameMs: 600,
  zoomMs: 350,
  turnMs: 600,
  topMs: 550,
});

/** The pose of a camera at `position` around `target`. */
export function orbitPoseOf(
  position: THREE.Vector3,
  target: THREE.Vector3,
): OrbitPose {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const dz = position.z - target.z;
  const distanceM = Math.hypot(dx, dy, dz) || 1;
  return {
    target: target.clone(),
    distanceM,
    polarRad: Math.acos(Math.min(1, Math.max(-1, dy / distanceM))),
    azimuthRad: Math.atan2(dx, dz),
  };
}

/** Where the camera of `pose` stands, into `out`. */
export function orbitPosition(
  pose: OrbitPose,
  out: THREE.Vector3,
): THREE.Vector3 {
  const { target, distanceM: d, polarRad: p, azimuthRad: a } = pose;
  return out.set(
    target.x + d * Math.sin(p) * Math.sin(a),
    target.y + d * Math.cos(p),
    target.z + d * Math.sin(p) * Math.cos(a),
  );
}

/** The ease-in-out cubic: 0 at 0, 1 at 1, gentle at both ends. */
function ease(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
}

/** `pose` within the orbit's limits. */
export function clampedPose(pose: OrbitPose): OrbitPose {
  return {
    target: pose.target,
    distanceM: Math.min(
      EDITOR_CAMERA.maxDistanceM,
      Math.max(EDITOR_CAMERA.minDistanceM, pose.distanceM),
    ),
    polarRad: Math.min(
      EDITOR_CAMERA.maxPolarAngle,
      Math.max(FLIGHT.topPolarRad, pose.polarRad),
    ),
    azimuthRad: pose.azimuthRad,
  };
}

/** The pose a flight from `from` to `to` has reached at `k` (0..1 of its
 *  time; outside, clamped). */
export function orbitPoseBetween(
  from: OrbitPose,
  to: OrbitPose,
  k: number,
): OrbitPose {
  const e = ease(Math.min(1, Math.max(0, Number.isFinite(k) ? k : 1)));
  const turn = Math.atan2(
    Math.sin(to.azimuthRad - from.azimuthRad),
    Math.cos(to.azimuthRad - from.azimuthRad),
  );
  const logFrom = Math.log(from.distanceM);
  return {
    target: from.target.clone().lerp(to.target, e),
    distanceM:
      e === 1
        ? to.distanceM
        : Math.exp(logFrom + (Math.log(to.distanceM) - logFrom) * e),
    polarRad: from.polarRad + (to.polarRad - from.polarRad) * e,
    azimuthRad: e === 1 ? to.azimuthRad : from.azimuthRad + turn * e,
  };
}

/** How far a camera stands to fit a sphere of `radiusM` in the editor's
 *  lens (m), never nearer than `FLIGHT.minFrameM`. */
export function frameDistanceM(radiusM: number): number {
  const half = (EDITOR_CAMERA.fovDeg * Math.PI) / 360;
  return Math.max(FLIGHT.minFrameM, (radiusM / Math.sin(half)) * 1.05);
}

/**
 * The goal of a flight from `now` to what stands at `at`: a station
 * framed by its radius (`radiusM`), an item or a code (`radiusM` its
 * size) brought to a working distance - the distance now, but at least
 * three frames of it and at most `FLIGHT.itemMaxM`. The turn is kept and
 * the tilt capped at `FLIGHT.flatCapRad`. RangeError for a radius that is
 * not a finite number >= 0.
 */
export function flightGoal(
  now: OrbitPose,
  to: {
    readonly at: THREE.Vector3;
    readonly radiusM: number;
    readonly kind: "station" | "item";
  },
): OrbitPose {
  if (!(Number.isFinite(to.radiusM) && to.radiusM >= 0)) {
    throw new RangeError(
      `a flight's radius must be a finite number >= 0, got ${to.radiusM}`,
    );
  }
  const distanceM =
    to.kind === "station"
      ? frameDistanceM(to.radiusM * FLIGHT.stationMargin)
      : Math.min(
          FLIGHT.itemMaxM,
          Math.max(frameDistanceM(to.radiusM) * 3, now.distanceM),
        );
  return clampedPose({
    target: to.at.clone(),
    distanceM,
    polarRad: Math.min(now.polarRad, FLIGHT.flatCapRad),
    azimuthRad: now.azimuthRad,
  });
}

/**
 * The sphere Frame fits for the whole tour: centred on the box around
 * every point, holding each point's circle (`radiusM`: a station's found
 * radius, 0 for a code); null without any point.
 */
export function tourFrame(
  points: readonly { readonly at: THREE.Vector3; readonly radiusM: number }[],
): { centre: THREE.Vector3; radiusM: number } | null {
  if (points.length === 0) return null;
  const box = new THREE.Box3();
  for (const p of points) box.expandByPoint(p.at);
  const centre = box.getCenter(new THREE.Vector3());
  let radiusM = 0;
  for (const p of points) {
    const r = p.at.distanceTo(centre) + Math.max(0, p.radiusM);
    if (Number.isFinite(r)) radiusM = Math.max(radiusM, r);
  }
  return { centre, radiusM };
}
