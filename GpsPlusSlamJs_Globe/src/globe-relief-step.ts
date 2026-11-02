/**
 * The relief's per-frame work around the band (one-scene plan §3.4;
 * frame-hitch plan H1), moved out of the globe lab:
 *
 * - `reliefClearance`: the drawn ground under the camera and how far the
 *   camera must rise to keep the clearance above it (review 2026-10-03-1835
 *   major 1: wherever the relief draws, the camera never comes closer to
 *   the drawn ground than the clearance, whoever owns the camera);
 * - `updateRelief`: the relief's camera and resolution, its exaggeration
 *   (an E step re-walks the tile tree, so its assignment is timed) and its
 *   tile update.
 *
 * @see globe-relief-step.ts.md
 */

import type * as THREE from "three";

import { clearedAltitudeM } from "./globe-flight.js";

/** The ellipsoid's part the clearance reads (3d-tiles-renderer's `Ellipsoid`). */
interface ReliefStepEllipsoid {
  getPositionToCartographic(
    position: THREE.Vector3,
    target: { lat?: number; lon?: number },
  ): { lat: number; lon: number };
}

export interface ReliefClearanceInput {
  ellipsoid: ReliefStepEllipsoid;
  /** The globe's frame: the camera's world position into ECEF. */
  group: THREE.Object3D;
  camera: THREE.Camera;
  /** The drawn ground (m) at a place (radians), null where none is loaded. */
  sampleGround: (lat: number, lon: number) => number | null;
  /** The camera's altitude (m). */
  altitudeM: number;
  /** The least height (m) the camera keeps above the drawn ground. */
  clearanceM: number;
}

export interface ReliefClearance {
  /** The drawn ground (m) under the camera, null where none is loaded. */
  groundM: number | null;
  /** The altitude (m) the clearance asks for (`clearedAltitudeM`). */
  clearedM: number;
  /** Whether the camera must rise: `clearedM` above its altitude. */
  lift: boolean;
}

/** The drawn ground under the camera and the lift that clears it. */
export function reliefClearance(input: ReliefClearanceInput): ReliefClearance {
  const { ellipsoid, group, camera, sampleGround, altitudeM, clearanceM } =
    input;
  const at = ellipsoid.getPositionToCartographic(
    group.worldToLocal(camera.position.clone()),
    {},
  );
  const groundM = sampleGround(at.lat, at.lon);
  const cleared = clearedAltitudeM(altitudeM, groundM, clearanceM);
  return { groundM, clearedM: cleared, lift: cleared > altitudeM };
}

/**
 * `position` (ECEF) moved along its geocentric radius (not the normal)
 * from the altitude `fromM` to `toM`, in place: the lab's lift, in its
 * own arithmetic (`(r + toM - fromM) / r`), so the result is bit-equal.
 */
export function liftAlongRadius(
  position: THREE.Vector3,
  fromM: number,
  toM: number,
): THREE.Vector3 {
  const r = position.length();
  return position.multiplyScalar((r + toM - fromM) / r);
}

/** What `updateRelief` uses of the relief's tiles and plugin. */
interface ReliefStepTiles {
  setCamera(camera: THREE.Camera): unknown;
  setResolution(camera: THREE.Camera, x: number, y: number): unknown;
  update(): void;
}
interface ReliefStepPlugin {
  heightScale: number;
}

export interface UpdateReliefInput {
  tiles: ReliefStepTiles;
  plugin: ReliefStepPlugin;
  camera: THREE.Camera;
  renderer: { getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2 };
  /** A scratch vector for the drawing buffer's size. */
  resolution: THREE.Vector2;
  /** The frame's exaggeration. */
  heightScale: number;
  /** Called after an E step with its cost (ms) and the new exaggeration. */
  onEStep: (ms: number, e: number) => void;
  /** The clock (ms) the E step is timed with. Defaults to `performance.now`. */
  clock?: () => number;
}

/** The relief's camera, resolution, exaggeration and tile update, in order. */
export function updateRelief(input: UpdateReliefInput): void {
  const { tiles, plugin, camera, renderer, resolution, heightScale } = input;
  const clock = input.clock ?? (() => performance.now());
  tiles.setCamera(camera);
  renderer.getDrawingBufferSize(resolution);
  tiles.setResolution(camera, resolution.x, resolution.y);
  if (heightScale !== plugin.heightScale) {
    const t0 = clock();
    plugin.heightScale = heightScale;
    input.onEStep(clock() - t0, heightScale);
  }
  tiles.update();
}
