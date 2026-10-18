/**
 * The first-person (eye-height) camera mode's rules (tour editor plan
 * 2026-10-17-1816 §13, "Camera at eye height"; G0 spikes Q3): frame time
 * was not the blocker at eye height (p95 at most 3.4 ms on a desktop); the
 * globe's camera rules were. This mode has its own:
 *
 * - a clearance of an eye height over the drawn ground, not the flight's
 *   100 m (`GLOBE_FLIGHT.clearanceM`, which lifts the lab's camera every
 *   frame);
 * - the tile library's controls allowed down to it (their 10 m minimum
 *   distance and 5 m camera radius stop short of eye height);
 * - a near plane that follows the nearest item as well as the ground:
 *   min(0.3 x the clearance, half the distance to the nearest item), at
 *   least 0.1 m, so a held item or the ground at the feet is not clipped;
 * - standard or reversed depth, never logarithmic (G0: logarithmic depth
 *   lost decal pixels at 2 and 4 km; standard and reversed drew them all).
 *
 * Pure apart from `applyEyeControls`, which sets three numbers on the
 * controls and gives back a function that restores them.
 *
 * @see globe-eye-camera.ts.md
 */
import type * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import { GLOBE_CLIP, clipPlanes } from "./globe-camera.js";

export const GLOBE_EYE = Object.freeze({
  /** The least height over the drawn ground (m): an eye height. */
  clearanceM: 1.7,
  /** The near plane's share of the camera's clearance (the globe's 0.3). */
  nearFraction: GLOBE_CLIP.nearFraction,
  /** The near plane's share of the distance to the nearest item. */
  itemShare: 0.5,
  /** The near plane's floor (m): G0's 0.05-0.1 m. */
  minNearM: 0.1,
  /**
   * The controls' limits in this mode: their camera radius (the least
   * distance they keep from the ground under the camera) is the eye
   * height, their least zoom distance half a metre (0.5.3's defaults: 5 m
   * and 10 m).
   */
  controls: Object.freeze({ cameraRadius: 1.7, minDistance: 0.5 }),
  /**
   * The renderer options for the depth buffer: reversed (three falls back
   * to standard, with a warning, where the context lacks EXT_clip_control),
   * never logarithmic. Spread into the app's `WebGLRenderer` options.
   */
  depth: Object.freeze({
    reversedDepthBuffer: true,
    logarithmicDepthBuffer: false,
  }),
});

/**
 * The near plane (m) for a camera `clearanceM` from the nearest drawn
 * ground and `nearestItemM` from the nearest item's surface (Infinity with
 * none): min(nearFraction x clearance, itemShare x item), at least
 * `minNearM`. RangeError for a clearance that is not finite and >= 0, or
 * an item distance that is negative or NaN.
 */
export function eyeNearM(
  clearanceM: number,
  nearestItemM = Number.POSITIVE_INFINITY,
): number {
  if (
    !(Number.isFinite(clearanceM) && clearanceM >= 0) ||
    !(nearestItemM >= 0)
  ) {
    throw new RangeError(
      `the clearance must be finite and >= 0 and the item distance >= 0, got ${clearanceM}, ${nearestItemM}`,
    );
  }
  return Math.max(
    GLOBE_EYE.minNearM,
    Math.min(
      GLOBE_EYE.nearFraction * clearanceM,
      GLOBE_EYE.itemShare * nearestItemM,
    ),
  );
}

/**
 * The clip planes in this mode: `eyeNearM` for the near plane, and the
 * globe's far plane (`clipPlanes`: past the horizon, a peak's horizon
 * added). `clearanceM` is the camera's distance to the nearest drawn ground
 * (`reliefClearanceM`; none over the bare ellipsoid); as in `clipPlanes`
 * the height above the ellipsoid caps it, since the globe's own surface is
 * drawn too. Same refusals as `clipPlanes` and `eyeNearM`.
 */
export function eyeClipPlanes(
  ellipsoid: Ellipsoid,
  position: THREE.Vector3,
  {
    clearanceM = Number.POSITIVE_INFINITY,
    nearestItemM = Number.POSITIVE_INFINITY,
    peakM = 0,
  }: { clearanceM?: number; nearestItemM?: number; peakM?: number } = {},
): { near: number; far: number } {
  const { far } = clipPlanes(ellipsoid, position, { clearanceM, peakM });
  const height = Math.min(
    Math.max(0, ellipsoid.getPositionElevation(position)),
    clearanceM,
  );
  const near = eyeNearM(height, nearestItemM);
  return { near, far: Math.max(far, near * 2) };
}

/**
 * The distance (m) from `position` to the nearest of `items`' bounding
 * spheres' surfaces, 0 inside one; Infinity without items. Spheres with a
 * negative radius (three's "empty") are skipped.
 */
export function nearestItemDistanceM(
  position: THREE.Vector3,
  items: Iterable<THREE.Sphere>,
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const sphere of items) {
    if (!(sphere.radius >= 0)) continue;
    const d = Math.max(0, position.distanceTo(sphere.center) - sphere.radius);
    if (d < nearest) nearest = d;
  }
  return nearest;
}

/** What `applyEyeControls` sets on the library's controls. */
export interface EyeControllable {
  cameraRadius: number;
  minDistance: number;
}

/**
 * Sets the controls' camera radius and least distance to this mode's
 * (`GLOBE_EYE.controls`); returns a function that restores the values they
 * had.
 */
export function applyEyeControls(controls: EyeControllable): () => void {
  const before = {
    cameraRadius: controls.cameraRadius,
    minDistance: controls.minDistance,
  };
  controls.cameraRadius = GLOBE_EYE.controls.cameraRadius;
  controls.minDistance = GLOBE_EYE.controls.minDistance;
  return () => {
    controls.cameraRadius = before.cameraRadius;
    controls.minDistance = before.minDistance;
  };
}
