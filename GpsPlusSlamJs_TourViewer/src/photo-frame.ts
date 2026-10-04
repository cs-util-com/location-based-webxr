/**
 * Which camera frame the creator's photo may use. See photo-frame.ts.md.
 */

import type { CapturedCameraFrame } from "gps-plus-slam-app-framework/ar/captured-camera-frame";

/**
 * Oldest frame the photo accepts, ms. Eight capture intervals (125 ms each):
 * enough slack for a busy frame loop, far below the seconds a tracking loss
 * freezes `latestFrame` for.
 */
export const PHOTO_FRAME_MAX_AGE_MS = 1000;

/**
 * The frame to encode and place the photo with, or `null` when there is none
 * or it is older than {@link PHOTO_FRAME_MAX_AGE_MS} (frames stop arriving
 * while tracking is lost, but the last one stays).
 *
 * @param nowEpochMs - `performance.timeOrigin + performance.now()`, the
 *   frame's `capturedAtMs` clock.
 */
export function usablePhotoFrame(
  frame: CapturedCameraFrame | null,
  nowEpochMs: number,
): CapturedCameraFrame | null {
  if (!frame) return null;
  return nowEpochMs - frame.capturedAtMs <= PHOTO_FRAME_MAX_AGE_MS
    ? frame
    : null;
}
