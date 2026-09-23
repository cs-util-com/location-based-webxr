/**
 * A camera frame paired with the camera pose and time of its capture.
 * See captured-camera-frame.ts.md.
 */

import {
  extractOdomPosition,
  extractOdomRotation,
  type ARPose,
} from '../types/ar-types';
import type { RgbaImage } from './qr/qr-frontend';
import type { Pose } from './qr/qr-pose';

/**
 * One captured camera frame. All fields describe the SAME XR frame: consumers
 * solve the pixels against `cameraPose` instead of reading "the pose now"
 * after an asynchronous decode.
 */
export interface CapturedCameraFrame {
  /** Top-left-origin RGBA pixels (an owned copy). */
  readonly image: RgbaImage;
  /** Camera pose in raw WebXR/odom space at capture. */
  readonly cameraPose: Pose;
  /** Capture time, epoch ms (`performance.timeOrigin + xrTime`) - the depth sampler's clock. */
  readonly capturedAtMs: number;
}

/** Reshape an ARPose ({x,y,z} / {x,y,z,w} objects) into Pose tuples. */
export function poseFromArPose(arPose: ARPose): Pose {
  return {
    position: extractOdomPosition(arPose),
    rotation: extractOdomRotation(arPose),
  };
}

/**
 * Build the frame, or `null` when there is no pose for it - an unpaired frame
 * must not be delivered, because every consumer would solve it against a
 * different moment.
 *
 * @param xrTimeMs - the XR animation-frame time (page-relative ms).
 * @param timeOriginMs - `performance.timeOrigin`; injectable for tests.
 */
export function capturedCameraFrame(
  image: RgbaImage,
  arPose: ARPose | null,
  xrTimeMs: number,
  timeOriginMs: number
): CapturedCameraFrame | null {
  if (!arPose) return null;
  return {
    image,
    cameraPose: poseFromArPose(arPose),
    capturedAtMs: timeOriginMs + xrTimeMs,
  };
}
