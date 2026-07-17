/**
 * Test seam (DEV-only) — see
 * GpsPlusSlamJs_Docs/docs/2026-06-01-0447-anchor-starter-e2e-test-plan.md §5 (Option A).
 *
 * The starter is glue-only: `main.ts` imports the AR/GPS framework functions
 * and calls them inside `startAr()` / `main()`. In a desktop Playwright browser
 * there is no WebXR, so `initAR` rejects and everything past the "Start AR" tap
 * is unreachable. To let the e2e suite drive the *real* placement → `?show=` →
 * copy-link glue, this single indirection lets `main.ts` read the framework
 * seams from an optional `window.__anchorStarterSeams` override, falling back to
 * the real imports.
 *
 * PROD-INERT GUARANTEE: the override is only consulted under
 * `import.meta.env.DEV && !import.meta.env.VITEST`. In a production build
 * `import.meta.env.DEV` is statically `false`, so Vite strips the whole branch
 * and the `window` read does not exist in the shipped bundle. During unit tests
 * (`VITEST`) the override is likewise ignored, so the seam can never swap
 * behaviour for real users. This module is side-effect free so it can be
 * unit-tested in isolation — covered by `seams.test.ts`.
 */

import { selectTrackingQuality } from "gps-plus-slam-app-framework/state";
import { selectAlignmentMatrix } from "gps-plus-slam-app-framework/state";
import {
  initAR,
  endARSession,
  getArWorldGroup,
  getCamera,
} from "gps-plus-slam-app-framework/ar/webxr-session";
import {
  startGpsWatch,
  startOrientationWatch,
  requestDeviceOrientationPermission,
} from "gps-plus-slam-app-framework/sensors";
import {
  checkWebXRSupport,
  checkGeolocationPermission,
} from "gps-plus-slam-app-framework/sensors";
import {
  createGpsAnchor,
  createWayfindingHud,
  enableArWorldGroupAlignment,
} from "gps-plus-slam-app-framework/visualization";

import { createAnchorMarker } from "./marker.js";
import { startReticleHitTest } from "./reticle-hit-test.js";

/** The framework/marker functions a Playwright e2e fake may override. */
export interface AnchorStarterSeams {
  checkWebXRSupport: typeof checkWebXRSupport;
  checkGeolocationPermission: typeof checkGeolocationPermission;
  /**
   * Since the framework's pre-init setter fold, the tracking store + restart
   * callback ride into `initAR` as its `callbacks.tracking` group (they arrive
   * TOGETHER — without the group the framework's per-frame
   * `updateTrackingState()` never dispatches `poseReceived`/`poseLost`,
   * leaving `tracking.phase` stuck at `initializing` and the onboarding
   * guidance pinned to "AR tracking lost"). The e2e fake asserts the group is
   * present on the `initAR` call it intercepts.
   */
  initAR: typeof initAR;
  endARSession: typeof endARSession;
  getArWorldGroup: typeof getArWorldGroup;
  getCamera: typeof getCamera;
  startGpsWatch: typeof startGpsWatch;
  startOrientationWatch: typeof startOrientationWatch;
  requestDeviceOrientationPermission: typeof requestDeviceOrientationPermission;
  createGpsAnchor: typeof createGpsAnchor;
  createWayfindingHud: typeof createWayfindingHud;
  enableArWorldGroupAlignment: typeof enableArWorldGroupAlignment;
  selectTrackingQuality: typeof selectTrackingQuality;
  selectAlignmentMatrix: typeof selectAlignmentMatrix;
  startReticleHitTest: typeof startReticleHitTest;
  createAnchorMarker: typeof createAnchorMarker;
}

declare global {
  interface Window {
    /** DEV-only e2e override; `undefined` in production (see prod-inert note). */
    __anchorStarterSeams?: Partial<AnchorStarterSeams>;
  }
}

/** The production seams — the unmodified framework + marker imports. */
export const realSeams: AnchorStarterSeams = {
  checkWebXRSupport,
  checkGeolocationPermission,
  initAR,
  endARSession,
  getArWorldGroup,
  getCamera,
  startGpsWatch,
  startOrientationWatch,
  requestDeviceOrientationPermission,
  createGpsAnchor,
  createWayfindingHud,
  enableArWorldGroupAlignment,
  selectTrackingQuality,
  selectAlignmentMatrix,
  startReticleHitTest,
  createAnchorMarker,
};

/**
 * Resolve the active framework seams. Returns the real imports unless a DEV-only
 * `window.__anchorStarterSeams` override is present (e2e tests). Inert in
 * production and during unit tests — see the prod-inert guarantee above.
 */
export function getSeams(): AnchorStarterSeams {
  if (
    import.meta.env.DEV &&
    !import.meta.env.VITEST &&
    typeof window !== "undefined" &&
    window.__anchorStarterSeams
  ) {
    return { ...realSeams, ...window.__anchorStarterSeams };
  }
  return realSeams;
}
