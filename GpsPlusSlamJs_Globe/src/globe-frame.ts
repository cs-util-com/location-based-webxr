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
const frameGround = new THREE.Vector3();
const cameraGround = new THREE.Vector3();

export const GLOBE_FRAME = Object.freeze({
  /**
   * The frame moves under the camera once the camera's ground point is
   * further than this from the frame's origin (m): at 20 km the flat frame
   * is 31 m off the curved ground and 0.18 degrees off its vertical, which
   * nothing drawn in the frame can show.
   */
  recentreDriftM: 20_000,
  /**
   * ... and only below this altitude (m): above it the frame's flatness
   * matters to nothing drawn (the ground sky, the haze and the volume live
   * below the hand-over edge, 80 km), and an orbiting camera would move it
   * every few frames.
   */
  recentreBelowM: 150_000,
});

/**
 * Where the world frame should move (volume-cloud plan §14): the camera's
 * ground point `nadir` when it is further than `recentreDriftM` from the
 * frame's origin `frame` and the camera is below `recentreBelowM`, else
 * null (no frame: null). The distance is the chord between the two ground
 * points on `ellipsoid`, within metres of the arc at this range.
 * RangeError for a non-finite position or altitude.
 */
export function frameRecentreTarget(
  ellipsoid: Ellipsoid,
  frame: LatLng | null,
  nadir: LatLng,
  altitudeM: number,
): LatLng | null {
  const values = [nadir.lat, nadir.lng, altitudeM];
  if (!values.every(Number.isFinite)) {
    throw new RangeError(
      `the camera's ground point and altitude must be finite, got ${values.join(", ")}`,
    );
  }
  if (frame === null || altitudeM > GLOBE_FRAME.recentreBelowM) return null;
  ellipsoid.getCartographicToPosition(
    frame.lat * DEG,
    frame.lng * DEG,
    0,
    frameGround,
  );
  ellipsoid.getCartographicToPosition(
    nadir.lat * DEG,
    nadir.lng * DEG,
    0,
    cameraGround,
  );
  return frameGround.distanceTo(cameraGround) > GLOBE_FRAME.recentreDriftM
    ? { lat: nadir.lat, lng: nadir.lng }
    : null;
}

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
