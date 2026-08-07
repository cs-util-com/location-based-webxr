/**
 * The recorder's per-XR-frame tick.
 *
 * Runs at render cadence (~60+ Hz), not GPS cadence (~1 Hz), because the four
 * things it drives are all smoothing/animation: the stats panels, the
 * alignment lerper, the camera follower, and the map overlay's reprojection.
 *
 * It is built before `initAR` and reads every resource through the shared
 * `ArSessionResources` record at fire time, so resources created later in
 * Enter-AR (and swapped per recording) are picked up without re-registration.
 *
 * Keep this cheap. Anything added here pays its cost on every rendered frame
 * of every session; work that can be driven by a store subscription or a
 * throttle belongs in `wire-ar-scene.ts` instead.
 */

import type * as THREE from 'three';
import type { ArSessionResources } from './ar-session-resources';

export interface ArFrameTickDeps {
  readonly resources: ArSessionResources;
  /** Live render camera; null before the renderer exists or between sessions. */
  readonly getCamera: () => THREE.Camera | null;
}

export function createArFrameTick({
  resources,
  getCamera,
}: ArFrameTickDeps): () => void {
  let lastFrameTime = performance.now();

  return () => {
    const now = performance.now();
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    // Advance the perf stats panels (FPS/ms/MB) once per rendered XR frame.
    resources.statsOverlay?.update();

    // Interpolate arWorldGroup.matrix toward the latest alignment (Issue 4).
    // Deliberately not camera-gated: alignment must keep converging even when
    // the render camera is momentarily unavailable.
    resources.alignmentLerper?.update(dt);

    const camera = getCamera();
    if (resources.cameraFollower && camera) {
      resources.cameraFollower.update(camera, dt);
    }

    // Issue #14: the map overlay is created lazily on the first toggle, and
    // its reprojection is the most expensive step here — skip it while hidden.
    if (resources.mapOverlay?.isVisible()) {
      // Pass the live render camera so heading-up rotation is computed
      // relative to where the user is actually looking (the same camera the
      // CSS3D overlay is composited through). See the 2026-06-29 plan.
      resources.mapOverlay.updatePosition(dt, camera ?? undefined);
    }
  };
}
