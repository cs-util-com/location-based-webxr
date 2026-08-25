/**
 * Device seam (DEV-overridable) for the TourViewer's AR modes.
 *
 * `main.ts` stays glue-only: it composes the tested modules (`ar-mode`,
 * `author-mode-flag`, the tour session) with the device-specific framework
 * functions resolved here. In a desktop Playwright browser there is no
 * WebXR / camera, so the e2e suite swaps fakes in via
 * `window.__tourViewerSeams` (installed with `addInitScript` before page
 * scripts run) — the QrTrackingDemo / AnchorStarter pattern.
 *
 * PROD-INERT GUARANTEE: the override is consulted only under
 * `import.meta.env.DEV && !import.meta.env.VITEST`. A production build
 * statically sets `import.meta.env.DEV` to `false`, so Vite strips the
 * branch and the `window` read never ships; unit tests (`VITEST`) ignore it
 * too. Covered by `seams.test.ts`.
 */

import {
  getArWorldGroup,
  startCameraFrameCapture,
  stopCameraFrameCapture,
  type EnableGpsArDeps,
} from "gps-plus-slam-app-framework/ar";
// Deep import on purpose: the /visualization barrel pulls the leaflet-based
// map modules, which crash in a windowless (node) unit-test environment.
import { enableArWorldGroupAlignment } from "gps-plus-slam-app-framework/visualization/ar-world-group-alignment";
import type { SubscribableStore } from "gps-plus-slam-app-framework/state";
import type { Object3D } from "three";

/** The device functions a Playwright e2e fake may override. */
export interface TourViewerSeams {
  /**
   * Injected into `createEnableGpsArController` — empty in production (the
   * controller's own defaults are the real device wiring); the e2e fake
   * supplies a full fake dep set here (support probe, permissions, watches,
   * initAR, endARSession).
   */
  controllerDeps: Partial<EnableGpsArDeps>;
  getArWorldGroup(): Object3D | null;
  enableArWorldGroupAlignment(options: {
    store: SubscribableStore;
    arWorldGroup: Object3D;
  }): unknown;
  startCameraFrameCapture(config?: { intervalMs?: number }): void;
  stopCameraFrameCapture(): void;
}

declare global {
  interface Window {
    /** DEV-only e2e override; `undefined` in production (see prod-inert note). */
    __tourViewerSeams?: Partial<TourViewerSeams>;
  }
}

/** The production seams — the unmodified framework device wiring. */
export const realSeams: TourViewerSeams = {
  controllerDeps: {},
  getArWorldGroup,
  enableArWorldGroupAlignment,
  startCameraFrameCapture,
  stopCameraFrameCapture,
};

/**
 * Resolve the active device seams — the real framework wiring unless a
 * DEV-only `window.__tourViewerSeams` override is present (e2e). Inert in
 * production and unit tests (see the prod-inert guarantee above).
 */
export function getSeams(): TourViewerSeams {
  if (
    import.meta.env.DEV &&
    !import.meta.env.VITEST &&
    typeof window !== "undefined" &&
    window.__tourViewerSeams
  ) {
    return { ...realSeams, ...window.__tourViewerSeams };
  }
  return realSeams;
}
