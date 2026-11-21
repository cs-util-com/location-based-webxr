/**
 * Camera placement on the globe: the surface radius along a direction, the
 * rotation of an orbit view, and a camera at an altitude looking at the
 * ground point under a pose at a given depression. Pure geometry, shared by
 * the flight paths, the meteor and the lab.
 *
 * @see oblique-camera.ts.md
 */

import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import type { OrbitPose } from "./globe-camera.js";

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

/**
 * A camera `altitudeM` above the ground point under `pose` (its surface
 * radius plus the altitude, from the centre), looking at that ground point
 * with a depression of `pitchDeg` below its local horizontal, from the
 * south: 90 degrees is the orbit view straight down; lower pitches move the
 * camera back along the meridian by the angle the triangle
 * centre-camera-ground gives. The screen's up is the pose's north.
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
