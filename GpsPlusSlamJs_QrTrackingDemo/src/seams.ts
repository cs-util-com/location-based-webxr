/**
 * Device seam (DEV-overridable) for the QR-tracking demo.
 *
 * `main.ts` is glue-only: it composes the tested modules (controller, debug
 * view, HUD, store) with the device-specific functions here. In a desktop
 * Playwright browser there is no WebXR / camera / depth, so the e2e suite swaps
 * a fake implementation in via `window.__qrDemoSeams` (installed with
 * `addInitScript` before page scripts run).
 *
 * PROD-INERT GUARANTEE: the override is consulted only under
 * `import.meta.env.DEV && !import.meta.env.VITEST`. A production build statically
 * sets `import.meta.env.DEV` to `false`, so Vite strips the branch and the
 * `window` read never ships; unit tests (`VITEST`) ignore it too. Covered by
 * `seams.test.ts`.
 *
 * The PROD frame/depth source is the **on-device-verified layer** (the §5 gate
 * is manual, exactly as the parent QR plan defers the Recorder's live camera
 * wiring): it uses the framework's public **camera-frame RGBA** capture
 * (`setCameraFrameCallback` + `startCameraFrameCapture`, B2 — top-left RGBA at
 * the detection cadence, no JPEG
 * round-trip) and the depth capture callback. The tested demo logic + the faked
 * e2e do not depend on its runtime behaviour. `startFrameSource` stays as the
 * e2e frame-injection seam; in PROD its body just points the framework QR
 * callback at the controller.
 *
 * The PROD **pose solver** is likewise device-verified: `loadSolvePose` loads
 * opencv.js (`opencv-loader.ts`) and wraps `solveQrPose`/`OpenCvPnpSquare` — the
 * production PnP path (Step-0 conversion). The e2e fakes it with a fixed solution
 * so the locked path runs without WASM.
 */

import {
  initAR,
  endARSession,
  getArWorldGroup,
  setCameraFrameCallback,
  startCameraFrameCapture,
  stopCameraFrameCapture,
  setDepthCaptureCallback,
  startDepthCapture,
  stopDepthCapture,
} from "gps-plus-slam-app-framework/ar/webxr-session";
import {
  createBarcodeDetectorFrontEnd,
  createDepthUnprojector,
  solveQrPose,
  OpenCvPnpSquare,
  type RgbaImage,
  type QrDetection,
} from "gps-plus-slam-app-framework/ar";
import { checkWebXRSupport } from "gps-plus-slam-app-framework/sensors";
import type {
  DepthSample,
  DepthPoint,
} from "gps-plus-slam-app-framework/types";
import type { Object3D } from "three";
import type { DemoCapabilitySupport } from "./capability.js";
import type { DepthContext, SolvePoseFn } from "./demo-controller.js";
import { loadOpenCv } from "./opencv-loader.js";

/** The device functions a Playwright e2e fake may override. */
export interface QrDemoSeams {
  checkSupport(): Promise<DemoCapabilitySupport>;
  initAR(container: HTMLElement): Promise<void>;
  endARSession(): Promise<void>;
  getArWorldGroup(): Object3D | null;
  /** A detect+decode function (BarcodeDetector front-end), or always-null. */
  createDetect(): (image: RgbaImage) => Promise<QrDetection | null>;
  /** Latest frame's depth context (unprojector + depth lookup + camera pose + intrinsics). */
  getDepthContext(): DepthContext | null;
  /**
   * Resolve the production PnP pose solver (loads OpenCV on first call). Resolves
   * to a closure wrapping `solveQrPose` + `OpenCvPnpSquare`; the controller calls
   * it once the size has converged. Rejects if OpenCV cannot load.
   */
  loadSolvePose(): Promise<SolvePoseFn>;
  /**
   * Start delivering frames to `onImage` at the given detection cadence
   * (`intervalMs`); returns a stop function. The frame source is the SINGLE
   * cadence owner (Option A): the controller it feeds runs `minIntervalMs: 0`.
   */
  startFrameSource(
    onImage: (image: RgbaImage) => void,
    options?: { intervalMs?: number },
  ): () => void;
}

declare global {
  interface Window {
    /** DEV-only e2e override; `undefined` in production (see prod-inert note). */
    __qrDemoSeams?: Partial<QrDemoSeams>;
  }
}

// --- PROD frame/depth state (the on-device-verified layer) -----------------

let latestDepthSample: DepthSample | null = null;

/**
 * The active QR-frame consumer (the controller's `offerFrame`), set by
 * `startFrameSource`. The framework QR callback (registered in `initAR`, before
 * the framework `initAR` runs — it must be set first, like the depth callback)
 * forwards each throttled RGBA frame here. `null` when no source is running.
 */
let qrFrameConsumer: ((image: RgbaImage) => void) | null = null;

/** Nearest-neighbour depth lookup over the sample's grid (screen-space). */
function nearestDepth(
  points: readonly DepthPoint[],
  screenX: number,
  screenY: number,
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const dx = p.screenX - screenX;
    const dy = p.screenY - screenY;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = p.depthM;
    }
  }
  return best;
}

/** The production seams — the unmodified framework device wiring. */
export const realSeams: QrDemoSeams = {
  async checkSupport(): Promise<DemoCapabilitySupport> {
    const xr = await checkWebXRSupport();
    // Depth support is confirmed at runtime when samples actually arrive; treat
    // it as available wherever WebXR is, and degrade if the depth callback never
    // fires (the auto-size path simply stays in 'unknown').
    return { webxr: xr.supported, depthSensing: xr.supported };
  },
  async initAR(container: HTMLElement): Promise<void> {
    // Depth + QR-frame callbacks must both be registered BEFORE initAR (the
    // framework creates the depth sampler and the QR frame source inside it).
    setDepthCaptureCallback((sample) => {
      latestDepthSample = sample;
    });
    // The framework now delivers top-left RGBA directly (B2) — no JPEG
    // round-trip. Forward each throttled frame to the active consumer.
    setCameraFrameCallback((image) => qrFrameConsumer?.(image));
    await initAR(container, {
      enableCameraAccess: true,
      enableDepthSensingFeature: true,
      enableCameraTextureAcquisition: true,
    });
    startDepthCapture();
  },
  async endARSession(): Promise<void> {
    stopDepthCapture();
    stopCameraFrameCapture();
    qrFrameConsumer = null;
    latestDepthSample = null;
    await endARSession();
  },
  getArWorldGroup,
  createDetect() {
    const frontEnd = createBarcodeDetectorFrontEnd();
    if (!frontEnd) return () => Promise.resolve(null);
    return (image) => frontEnd.detect(image);
  },
  getDepthContext(): DepthContext | null {
    const sample = latestDepthSample;
    if (!sample?.projectionMatrix) return null;
    const unprojector = createDepthUnprojector(
      sample.cameraPos,
      sample.cameraRot,
      sample.projectionMatrix,
    );
    if (!unprojector) return null;
    return {
      unprojector,
      depthAt: (x, y) => nearestDepth(sample.points, x, y),
      cameraPose: { position: sample.cameraPos, rotation: sample.cameraRot },
      projectionMatrix: sample.projectionMatrix,
    };
  },
  async loadSolvePose(): Promise<SolvePoseFn> {
    // Load opencv.js once, build a reusable PnP solver, and wrap the production
    // `solveQrPose`. The solver lives for the session (the demo never disposes
    // it — acceptable for a debug tool; per-solve Mats are freed internally).
    const cv = await loadOpenCv();
    const solver = new OpenCvPnpSquare(cv);
    return (input) => solveQrPose({ ...input, solver });
  },
  startFrameSource(
    onImage: (image: RgbaImage) => void,
    options?: { intervalMs?: number },
  ): () => void {
    // The framework camera-frame callback (wired in initAR) forwards frames to
    // whatever consumer is active. Point it at this controller and start the
    // throttled capture — the source is the single cadence owner (Option A).
    qrFrameConsumer = onImage;
    startCameraFrameCapture(
      options?.intervalMs !== undefined
        ? { intervalMs: options.intervalMs }
        : undefined,
    );
    return () => {
      qrFrameConsumer = null;
      stopCameraFrameCapture();
    };
  },
};

/**
 * Resolve the active device seams — the real framework wiring unless a DEV-only
 * `window.__qrDemoSeams` override is present (e2e). Inert in production and unit
 * tests (see the prod-inert guarantee above).
 */
export function getSeams(): QrDemoSeams {
  if (
    import.meta.env.DEV &&
    !import.meta.env.VITEST &&
    typeof window !== "undefined" &&
    window.__qrDemoSeams
  ) {
    return { ...realSeams, ...window.__qrDemoSeams };
  }
  return realSeams;
}
