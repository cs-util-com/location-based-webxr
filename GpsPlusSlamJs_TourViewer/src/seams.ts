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
  getCamera,
  getCurrentArPose,
  getScene,
  startCameraFrameCapture,
  stopCameraFrameCapture,
  type EnableGpsArDeps,
} from "gps-plus-slam-app-framework/ar";
import {
  createBarcodeDetectorFrontEnd,
  type QrFrontEnd,
  type RgbaImage,
} from "gps-plus-slam-app-framework/ar/qr/qr-frontend";
import {
  intrinsicsFromProjection,
  solveQrPose,
  type CameraIntrinsics,
  type Pose,
  type QrPoseSolution,
} from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { QrSolvePoseInput } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import { PlanarPnpSquare } from "gps-plus-slam-app-framework/ar/qr/planar-pnp";
import {
  createQrDebugView,
  type QrDebugView,
} from "gps-plus-slam-app-framework/ar/qr/qr-debug-view";
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
  /** BarcodeDetector-backed detect+decode, or `null` where unavailable
   *  (desktop Chromium — there is no fallback detector by design). */
  createQrFrontEnd(): QrFrontEnd | null;
  /** The planar-PnP square solver (pure JS, OpenCV-free). */
  solveQrPose(input: QrSolvePoseInput): QrPoseSolution | null;
  /** Current XR-frame camera pose in RAW WebXR/odom space, as tuples. */
  getCameraPose(): Pose | null;
  /** PnP intrinsics from the in-session camera projection, scaled to the
   *  DETECTOR buffer's dimensions (buffer mismatch is the #1 PnP risk). */
  getIntrinsics(image: RgbaImage): CameraIntrinsics | null;
  /** The shared axis+cube glue check, parented under the world group — the
   *  one accuracy check a human at the poster can perform (spread alone is
   *  precision). */
  createQrDebugView(parent: Object3D): QrDebugView;
  /** The SCENE ROOT — where built-once content in raw GPS-world NUE lives
   *  (the framework's parenting rule; `arWorldGroup` children would need
   *  alignment-inverse coordinates instead). */
  getScene(): Object3D | null;
}

declare global {
  interface Window {
    /** DEV-only e2e override; `undefined` in production (see prod-inert note). */
    __tourViewerSeams?: Partial<TourViewerSeams>;
  }
}

/** One shared solver instance — stateless between solves. */
const pnpSolver = /* @__PURE__ */ new PlanarPnpSquare();

/** The production seams — the unmodified framework device wiring. */
export const realSeams: TourViewerSeams = {
  controllerDeps: {},
  getArWorldGroup,
  enableArWorldGroupAlignment,
  startCameraFrameCapture,
  stopCameraFrameCapture,
  createQrFrontEnd: () => createBarcodeDetectorFrontEnd(),
  solveQrPose: (input) => solveQrPose({ ...input, solver: pnpSolver }),
  // The CURRENT XR-frame pose, reshaped from ARPose objects to Pose tuples —
  // the RecorderApp's documented recipe (raw WebXR/odom space).
  getCameraPose: () => {
    const arPose = getCurrentArPose();
    if (!arPose) return null;
    return {
      position: [arPose.position.x, arPose.position.y, arPose.position.z],
      rotation: [
        arPose.orientation.x,
        arPose.orientation.y,
        arPose.orientation.z,
        arPose.orientation.w,
      ],
    };
  },
  // Depth is OFF in this app (QD-5), so the projection comes from the
  // in-session three camera — WebXR owns its projectionMatrix during an
  // immersive session (the wayfinding-placement precedent) — scaled to the
  // DETECTOR buffer's width/height, never the render size.
  getIntrinsics: (image) => {
    const camera = getCamera();
    if (!camera) return null;
    return intrinsicsFromProjection(
      camera.projectionMatrix.toArray(),
      image.width,
      image.height,
    );
  },
  createQrDebugView,
  getScene,
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
