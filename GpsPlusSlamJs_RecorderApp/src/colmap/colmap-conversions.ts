/**
 * COLMAP Coordinate + Intrinsics Conversions
 *
 * Pure math turning the recorder's persisted WebXR data into the conventions
 * COLMAP's `sparse/0/` text files expect (occupancy/COLMAP export plan Iter 1,
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-1205-colmap-export-plan.md §2.3).
 * No THREE scene graph, no DOM, no Redux — mirrors the discipline of
 * `depth-unprojection.ts` / `frame-conversions.ts` (one tested seam owning the
 * axis/sign conventions).
 *
 * The pose conversion {@link webxrToColmapPose}: a WebXR camera pose (−Z
 * forward, +Y up, camera-to-world) → COLMAP `(qvec, tvec)` (+Z forward, +Y
 * down, world-to-camera). The intrinsics (`pinholeFromProjection`) live in
 * the framework (`utils/pinhole-from-projection.ts`), shared with the Tour
 * Viewer.
 *
 * @see colmap-conversions.ts.md for the derivations.
 */

import * as THREE from 'three';
import type { Quaternion, Vector3 } from 'gps-plus-slam-app-framework/core';

/**
 * World-to-camera quaternion in COLMAP's storage order `[qw, qx, qy, qz]`
 * (note: COLMAP lists the scalar component FIRST, unlike the library's
 * `Quaternion` which is `[x, y, z, w]`).
 */
type ColmapQuat = readonly [number, number, number, number];

/**
 * A COLMAP `images.txt` extrinsic: rotation + translation that map a world
 * point into the camera frame, `X_cam = R(qvec) · X_world + tvec`.
 */
export interface ColmapPose {
  readonly qvec: ColmapQuat;
  readonly tvec: Vector3;
}

/**
 * Basis change from the WebXR camera frame (+x right, +y up, −z forward) to
 * the COLMAP camera frame (+x right, +y down, +z forward): negate Y and Z.
 * This is a 180° rotation about the camera X axis (det = +1, a proper
 * rotation — so `decompose` below never folds a sign into the quaternion).
 * Module-constant: it never changes and the conversion treats it read-only.
 */
const WEBXR_TO_COLMAP_CAM = new THREE.Matrix4().makeScale(1, -1, -1);

/**
 * Basis change from the raw-WebXR **world** frame (+Y up, right-handed) to the
 * COLMAP/3DGS-viewer world convention (+Y-down gravity): negate Y and Z. Like
 * {@link WEBXR_TO_COLMAP_CAM} this is a 180° rotation about X (det = +1, a
 * *proper* rotation), so the reconstruction loads **upright** without mirroring.
 *
 * Without it the export is internally consistent but loads upside-down in
 * Lichtfeld Studio / gsplat / Nerfstudio, which treat the COLMAP world as
 * Y-down gravity while our world is WebXR Y-up. The SAME `G` is applied to the
 * camera extrinsics here and to exported points via {@link webxrToColmapWorldPoint},
 * so cameras and points stay registered (a surface point still projects to the
 * pixel its camera saw). See follow-up Item B:
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-2203-colmap-export-followup-plan.md.
 */
const WEBXR_TO_COLMAP_WORLD = new THREE.Matrix4().makeScale(1, -1, -1);

/**
 * Convert a WebXR camera pose to a COLMAP extrinsic.
 *
 * WebXR hands back a *camera-to-world* pose in a frame whose camera looks down
 * −Z with +Y up. COLMAP stores a *world-to-camera* extrinsic in a frame whose
 * camera looks down +Z with +Y down. The conversion therefore (1) applies the
 * camera-frame basis change {@link WEBXR_TO_COLMAP_CAM} on the right of the
 * camera-to-world matrix, (2) inverts to world-to-camera, then (3) post-
 * multiplies by the world basis change {@link WEBXR_TO_COLMAP_WORLD} so the
 * extrinsic maps the *flipped* COLMAP world (Y-down gravity) into the camera —
 * `worldToCam · G` leaves `tvec` unchanged and only rotates `R`.
 *
 * @param position - camera position, raw WebXR (e.g. `ArImageCapture.position`
 *   after the NUE→WebXR conversion that `selectFrameTilesInWebXR` applies).
 * @param rotation - camera quaternion `[x, y, z, w]`, raw WebXR.
 * @returns `{ qvec: [qw, qx, qy, qz], tvec: [tx, ty, tz] }`.
 */
export function webxrToColmapPose(
  position: Vector3,
  rotation: Quaternion
): ColmapPose {
  const quat = new THREE.Quaternion(
    rotation[0],
    rotation[1],
    rotation[2],
    rotation[3]
  );
  const pos = new THREE.Vector3(position[0], position[1], position[2]);

  // camera-to-world (WebXR) → COLMAP-camera-to-world → world-to-camera, then
  // re-express in the flipped COLMAP world frame (post-multiply by G).
  const worldToCam = new THREE.Matrix4()
    .compose(pos, quat, UNIT_SCALE)
    .multiply(WEBXR_TO_COLMAP_CAM)
    .invert()
    .multiply(WEBXR_TO_COLMAP_WORLD);

  const outQuat = new THREE.Quaternion();
  const outPos = new THREE.Vector3();
  worldToCam.decompose(outPos, outQuat, new THREE.Vector3());

  return {
    qvec: [outQuat.w, outQuat.x, outQuat.y, outQuat.z],
    tvec: [outPos.x, outPos.y, outPos.z],
  };
}

/**
 * Map a raw-WebXR world point into the COLMAP world frame: negate Y and Z (the
 * 180°-about-X {@link WEBXR_TO_COLMAP_WORLD} basis change). This is the SAME `G`
 * that {@link webxrToColmapPose} folds into the camera extrinsics, applied to
 * the exported `points3D` so the seed cloud and the cameras stay registered and
 * the reconstruction loads upright. Pure component negation — no matrix needed.
 */
export function webxrToColmapWorldPoint(point: Vector3): Vector3 {
  return [point[0], -point[1], -point[2]];
}

const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
