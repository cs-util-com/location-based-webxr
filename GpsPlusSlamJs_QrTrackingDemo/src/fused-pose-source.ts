/**
 * The demo's fused QR pose (QR near-frontal pose plan M3b b5): one fused
 * tracker per decoded payload over the `qrDetected` slice's current-epoch
 * detections. The overlay takes the pose only once the window is stable;
 * until then the controller falls back to the raw frame pose, as before.
 * See fused-pose-source.ts.md.
 */

import {
  createFusedQrPoseTracker,
  type FusedQrPoseTracker,
  type Pose,
  type QrFusedPose,
  type QrFusedPoseOptions,
} from "gps-plus-slam-app-framework/ar/qr";
import {
  selectQrFusedEntries,
  type RootWithQrDetected,
} from "gps-plus-slam-app-framework/state";

export interface FusedPoseSource {
  /** The stable fused pose of `text`, or null while there is none. */
  resolve(state: RootWithQrDetected, text: string): Pose | null;
  /** The last evaluation for `text` (HUD / diagnostics), or null if never read. */
  last(text: string): QrFusedPose | null;
}

export function createFusedPoseSource(
  options: QrFusedPoseOptions = {},
): FusedPoseSource {
  const trackers = new Map<string, FusedQrPoseTracker>();
  const results = new Map<string, QrFusedPose>();
  const trackerFor = (text: string): FusedQrPoseTracker => {
    let tracker = trackers.get(text);
    if (!tracker) {
      tracker = createFusedQrPoseTracker(options);
      trackers.set(text, tracker);
    }
    return tracker;
  };
  return {
    resolve(state, text) {
      const result = trackerFor(text).evaluate(
        selectQrFusedEntries(state, text),
      );
      results.set(text, result);
      return result.status === "stable" ? result.pose : null;
    },
    last(text) {
      return results.get(text) ?? null;
    },
  };
}
