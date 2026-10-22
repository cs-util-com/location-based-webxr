/**
 * The 3D editor's camera: an orbit around the tour with the chosen design's
 * start and limits (the chosen design's: 148 m east, 210 m up and 177 m south of the
 * centre, so about 312 m out and 47.7 degrees from straight down, above
 * the morph band's 42; between 2.5 m and 1100 m from its centre, never
 * below 1.48 rad from straight down), the tilt the morph reads, and the
 * clip planes, which follow the camera's clearance over the drawn ground
 * (the globe's rule, `clipPlanes` and `reliefClearanceM`) with the
 * editor's own floor and reach: a 0.2 m near floor (the globe's 1 m
 * clipped an item in front of a camera at the orbit's 2.5 m) and an 8 km
 * far plane, past the fog's end, where the view ends.
 *
 * @see editor3d-camera.ts.md
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  GLOBE_CLIP,
  clipPlanes,
  reliefClearanceM,
} from "gps-plus-slam-globe/editor";

/** The chosen design's camera. */
export const EDITOR_CAMERA = Object.freeze({
  fovDeg: 50,
  /** The start, from the orbit's centre (m: x east, y up, z south). */
  startOffset: Object.freeze([148, 210, 177] as const),
  minDistanceM: 2.5,
  maxDistanceM: 1100,
  /** The lowest the camera may go, from straight down (rad). */
  maxPolarAngle: 1.48,
});

/** The editor's clip limits and the fog they reach past (m). */
export const EDITOR_CLIP = Object.freeze({
  minNearM: 0.2,
  farM: 8000,
  fogStartM: 1400,
  fogEndM: 5200,
});

/** The start position for an orbit around `target`, into `out`. */
export function startCameraPosition(
  target: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out.copy(target).add(new THREE.Vector3(...EDITOR_CAMERA.startOffset));
}

/** The tilt the morph reads: the orbit's polar angle (rad, 0 straight
 *  down) in degrees. RangeError for an angle that is not finite. */
export function tiltDegOf(polarAngleRad: number): number {
  if (!Number.isFinite(polarAngleRad)) {
    throw new RangeError(
      `the camera's angle must be finite, got ${polarAngleRad}`,
    );
  }
  return (polarAngleRad * 180) / Math.PI;
}

/**
 * The near and far planes for a camera at `cameraEcef`: the near plane
 * the globe's fraction of the clearance to the nearest of the drawn-ground
 * `samples` (each `distanceM` away horizontally, at `groundM` over the
 * ellipsoid, null when not loaded; without any, the height over the
 * ellipsoid), floored at `EDITOR_CLIP.minNearM`; the far plane
 * `EDITOR_CLIP.farM`, or the globe's horizon where that is nearer.
 */
export function editorClipPlanes(input: {
  readonly ellipsoid: Parameters<typeof clipPlanes>[0];
  readonly cameraEcef: THREE.Vector3;
  readonly samples: readonly { distanceM: number; groundM: number | null }[];
}): { near: number; far: number } {
  const altitude = input.ellipsoid.getPositionElevation(input.cameraEcef);
  const clearanceM = reliefClearanceM(altitude, input.samples);
  const globe = clipPlanes(input.ellipsoid, input.cameraEcef, { clearanceM });
  const near = Math.max(
    EDITOR_CLIP.minNearM,
    Math.min(Math.max(0, altitude), clearanceM) * GLOBE_CLIP.nearFraction,
  );
  return {
    near,
    far: Math.max(Math.min(globe.far, EDITOR_CLIP.farM), near * 2),
  };
}

/** The camera and its orbit, on `domElement`, around `target`. */
export function createEditorCamera(input: {
  readonly domElement: HTMLElement;
  readonly target: THREE.Vector3;
  readonly aspect: number;
}): {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** The orbit's tilt now, degrees from straight down. */
  tiltDeg(): number;
  dispose(): void;
} {
  const camera = new THREE.PerspectiveCamera(
    EDITOR_CAMERA.fovDeg,
    input.aspect,
    1,
    100_000,
  );
  startCameraPosition(input.target, camera.position);
  const controls = new OrbitControls(camera, input.domElement);
  controls.target.copy(input.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = EDITOR_CAMERA.maxPolarAngle;
  controls.minDistance = EDITOR_CAMERA.minDistanceM;
  controls.maxDistance = EDITOR_CAMERA.maxDistanceM;
  controls.update();
  return {
    camera,
    controls,
    tiltDeg: () => tiltDegOf(controls.getPolarAngle()),
    dispose: () => {
      controls.dispose();
    },
  };
}
