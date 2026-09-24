/**
 * The demo's restart wiring (QR near-frontal pose plan M3b b5): the
 * session's `tracking` callbacks group, around a store of its own. The
 * session dispatches every frame's pose into that store and calls
 * `onRestarted` after an odometry restart; the demo turns that into a QR
 * frame change. A SEPARATE store, so the per-frame dispatches never reach
 * the HUD's store, which re-renders on every change. See
 * restart-tracking.ts.md.
 */

import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

export function createRestartTracking(onFrameChanged: () => void) {
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
  });
  return {
    store,
    onRestarted: () => {
      onFrameChanged();
    },
  };
}
