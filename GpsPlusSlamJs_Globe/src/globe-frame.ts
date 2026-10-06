/**
 * The globe's world frame (F2 plan 2026-10-03-1922 F2a, M3): a local frame
 * at the target, x east, y up and the origin on the ground there, so the
 * framework's sky, haze and cloud slab (which read the zenith from world y)
 * work below the band, and the camera's coordinates stay small near the
 * ground. The page puts the frame's matrix on the group that holds both
 * carriers and the sun; every camera writer and reader converts through
 * the two functions here, never by assuming world = ECEF.
 *
 * @see globe-frame.ts.md
 */
import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import type { LatLng } from "./globe-target.js";

const DEG = Math.PI / 180;
const east = new THREE.Vector3();
const north = new THREE.Vector3();
const up = new THREE.Vector3();
const origin = new THREE.Vector3();
const south = new THREE.Vector3();
const local = new THREE.Matrix4();
const rotation = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();

/**
 * The matrix from ECEF to the local world at `target`: the target's ground
 * point at the origin, east on x, up on y, north on -z. Written into
 * `out`. RangeError for a latitude outside [-90, 90] or a non-finite one.
 */
export function worldFromEcefAt(
  ellipsoid: Ellipsoid,
  target: LatLng,
  out: THREE.Matrix4,
): THREE.Matrix4 {
  const { lat, lng } = target;
  if (!(Math.abs(lat) <= 90 && Number.isFinite(lng))) {
    throw new RangeError(
      `the frame needs a latitude in [-90, 90] and a finite longitude, got ${lat}, ${lng}`,
    );
  }
  // Written out (the library's axes are NaN at a pole): east along the
  // parallel, up the geodetic normal, north = up x east, defined everywhere.
  const phi = lat * DEG;
  const lambda = lng * DEG;
  east.set(-Math.sin(lambda), Math.cos(lambda), 0);
  up.set(
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  );
  north.crossVectors(up, east).normalize();
  ellipsoid.getCartographicToPosition(phi, lambda, 0, origin);
  south.copy(north).negate();
  // Local to ECEF: the columns are east, up and south (right-handed).
  local.makeBasis(east, up, south).setPosition(origin);
  return out.copy(local).invert();
}

/** A camera pose in ECEF: a position (m) and an orientation. */
export interface EcefPose {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

/**
 * Places `camera` at an ECEF pose, through the frame `worldFromEcef` (the
 * group's matrix): the ONE way the page writes a camera pose. Updates the
 * camera's world matrix.
 */
export function applyEcefPose(
  camera: THREE.Object3D,
  pose: EcefPose,
  worldFromEcef: THREE.Matrix4,
): void {
  worldFromEcef.decompose(scratchPosition, rotation, scratchScale);
  camera.position.copy(pose.position).applyMatrix4(worldFromEcef);
  camera.quaternion.copy(rotation).multiply(pose.quaternion);
  camera.updateMatrixWorld();
}

/** The camera's pose in ECEF, through the frame: the ONE way it is read. */
export function ecefPoseOf(
  camera: THREE.Object3D,
  worldFromEcef: THREE.Matrix4,
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const ecefFromWorld = local.copy(worldFromEcef).invert();
  ecefFromWorld.decompose(scratchPosition, rotation, scratchScale);
  return {
    position: camera.position.clone().applyMatrix4(ecefFromWorld),
    quaternion: rotation.clone().multiply(camera.quaternion),
  };
}
