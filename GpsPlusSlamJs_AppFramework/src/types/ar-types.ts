/**
 * Shared AR Types
 *
 * Common type definitions for AR-related modules.
 * These are extracted to a separate file to avoid circular dependencies
 * between webxr-session.ts and depth-sampler.ts.
 */

import type { Vector3, Quaternion, Matrix4 } from 'gps-plus-slam-js';

/**
 * Tuple-form AR pose for storage/serialization.
 *
 * The tuple equivalent of ARPose — uses the library's readonly Vector3/Quaternion
 * tuples instead of object-form { x, y, z }. Used in storage interfaces where
 * poses are persisted as plain number arrays in JSON.
 *
 * @see ARPose for the object-form variant used in live AR tracking
 * @see 2026-03-03-code-review-inline-type-duplication.md Finding #6
 */
export interface ArPoseTuples {
  readonly position: Vector3;
  readonly rotation: Quaternion;
}

/**
 * 3D position in object-form as returned by the WebXR API (XRViewerPose).
 * Distinct from the library's tuple-form `Vector3` (`readonly [number, number, number]`).
 */
export interface WebXRVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Quaternion orientation in object-form as returned by the WebXR API (XRViewerPose).
 * Distinct from the library's tuple-form `Quaternion` (`readonly [number, number, number, number]`).
 */
export interface WebXRQuaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/**
 * Device pose in AR space.
 * Position and orientation are in the local-floor reference space.
 * This is the RAW pose, NOT transformed by any alignment matrix.
 */
export interface ARPose {
  readonly position: WebXRVec3;
  readonly orientation: WebXRQuaternion;
}

/**
 * Extract the raw odometry position tuple from an {@link ARPose}.
 *
 * Returns the raw WebXR position without coordinate conversion — the reducer
 * applies the WebXR→NUE transform when storing into state (raw-storage
 * pattern, see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-09-raw-storage-convert-on-read.md).
 * WebXR local-floor frame: X=East, Y=Up, Z=South (toward viewer / backward).
 *
 * Lives next to the type (quality-review G-8 — it used to sit in
 * `state/gps-event-coordinator.ts`, forcing an ar→state import in
 * `ar/depth-sampler.ts`).
 */
export function extractOdomPosition(arPose: ARPose): Vector3 {
  return [arPose.position.x, arPose.position.y, arPose.position.z];
}

/** Extract the raw odometry rotation tuple from an {@link ARPose}. */
export function extractOdomRotation(arPose: ARPose): Quaternion {
  return [
    arPose.orientation.x,
    arPose.orientation.y,
    arPose.orientation.z,
    arPose.orientation.w,
  ];
}

/**
 * An sRGB color triple, 0–255 integers per channel. Kept as plain ints so
 * persisted JSON stays compact (~3 bytes/point in practice).
 */
export type RgbTuple = readonly [number, number, number];

/**
 * A single depth point sample from WebXR Depth API.
 * Used for 3D reconstruction and validating AR tracking accuracy.
 */
export interface DepthPoint {
  /** Normalized screen X coordinate (0-1) */
  readonly screenX: number;
  /** Normalized screen Y coordinate (0-1) */
  readonly screenY: number;
  /** Depth value in meters */
  readonly depthM: number;
  /**
   * Camera color at (screenX, screenY), sampled from the same XR frame as
   * the depth read (occupancy-grid port plan Iter 8). Optional + additive:
   * recordings made before 2026-06 (or with the RGB recording option off)
   * carry no color; consumers must fall back (e.g. height-based cube
   * coloring).
   */
  readonly rgb?: RgbTuple;
}

/**
 * A complete depth sample with camera pose and grid of depth points.
 * Produced by the depth sampler at ~1 Hz, consumed by the store for
 * persistence and replay. This is the single canonical type, re-exported
 * by `store.ts` for dispatch convenience.
 */
export interface DepthSample {
  /** Timestamp in milliseconds */
  readonly timestamp: number;
  /**
   * Camera position in **raw WebXR** convention [x=East, y=Up, z=South].
   * NOT in NUE — the recordDepthSample reducer is conversion-free (it only
   * stores the latest sample for subscribers), so no webxrToNUE conversion
   * is ever applied. Consumers needing NUE must convert themselves; the
   * occupancy-grid pipeline works directly in this raw frame.
   */
  readonly cameraPos: Vector3;
  /**
   * Camera rotation quaternion in **raw WebXR** convention [x, y, z, w].
   * NOT in NUE — same reasoning as cameraPos.
   */
  readonly cameraRot: Quaternion;
  /** Grid of depth points */
  readonly points: readonly DepthPoint[];
  /**
   * Projection matrix of the capturing XRView (16 floats, column-major,
   * serializable tuple — not a THREE.Matrix4). Camera intrinsics needed to
   * unproject (screenX, screenY, depthM) back into a 3D AR-space point.
   * Optional: recordings made before 2026-06 do not carry it; consumers
   * must skip unprojection for such samples.
   */
  readonly projectionMatrix?: Matrix4;
}
