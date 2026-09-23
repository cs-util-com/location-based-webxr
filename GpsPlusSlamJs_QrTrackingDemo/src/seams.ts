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
 * (initAR `callbacks.cameraFrame` + `startCameraFrameCapture`, B2 — top-left
 * RGBA at the detection cadence, no JPEG
 * round-trip) and the depth capture callback. The tested demo logic + the faked
 * e2e do not depend on its runtime behaviour. `startFrameSource` stays as the
 * e2e frame-injection seam; in PROD its body just points the framework QR
 * callback at the controller.
 */

import {
  initAR,
  endARSession,
  getArWorldGroup,
  startCameraFrameCapture,
  stopCameraFrameCapture,
  startDepthCapture,
  stopDepthCapture,
  type CameraFrameCaptureConfig,
} from "gps-plus-slam-app-framework/ar/webxr-session";
import type { CaptureTiming } from "gps-plus-slam-app-framework/ar/camera-blit-capture";
import {
  type BarcodeDetectorFrontEnd,
  createBarcodeDetectorFrontEnd,
  createQrSizeDepthContext,
  type RgbaImage,
  type QrDetection,
  type CapturedCameraFrame,
} from "gps-plus-slam-app-framework/ar";
import { checkWebXRSupport } from "gps-plus-slam-app-framework/sensors";
import type { DepthSample } from "gps-plus-slam-app-framework/types";
import { parseCaptureSizeParam } from "./capture-size-param.js";
import type { Object3D } from "three";
import type { DemoCapabilitySupport } from "./capability.js";
import type { DepthContext } from "./demo-controller.js";

/** Options for {@link QrDemoSeams.startFrameSource}. */
interface FrameSourceOptions {
  intervalMs?: number;
  /** The opt-in `?qrperf` per-capture stage timings. */
  onCaptureTiming?: (timing: CaptureTiming) => void;
  /** Capture veto: `false` while the detector is busy (skips the readback). */
  wantsFrame?: () => boolean;
}

/** The device functions a Playwright e2e fake may override. */
export interface QrDemoSeams {
  checkSupport(): Promise<DemoCapabilitySupport>;
  initAR(container: HTMLElement): Promise<void>;
  endARSession(): Promise<void>;
  getArWorldGroup(): Object3D | null;
  /**
   * A detect+decode function (BarcodeDetector front-end), or always-null.
   * `copyPixels` restores the pre-fix full copy per decode, for the
   * `?qrperf=1&baseline=1` A/B run only.
   */
  createDetect(options?: {
    copyPixels?: boolean;
    onCopyMs?: (ms: number) => void;
  }): (image: RgbaImage) => Promise<QrDetection | null>;
  /** Latest depth sample's context (unprojector + depth lookup + projection). */
  getDepthContext(): DepthContext | null;
  /**
   * Start delivering captured frames (pixels + capture pose) to `onFrame` at the given detection cadence
   * (`intervalMs`); returns a stop function. The frame source is the SINGLE
   * cadence owner (Option A): the controller it feeds runs `minIntervalMs: 0`.
   */
  startFrameSource(
    onFrame: (frame: CapturedCameraFrame) => void,
    options?: FrameSourceOptions,
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
 * `startFrameSource`. The framework QR callback (passed to the framework
 * `initAR` as its `callbacks.cameraFrame` group, like the depth callback)
 * forwards each throttled RGBA frame here. `null` when no source is running.
 */
let qrFrameConsumer: ((frame: CapturedCameraFrame) => void) | null = null;

/**
 * Depth capture tuning for the QR demo (WS-A 2a). A DENSER grid than the SLAM
 * default (16) so a small QR has several depth nodes across its face, sampled
 * FASTER than the 1 Hz default so the size correlates with the ~8 Hz detection
 * cadence. `rgb: false` skips the per-point colour blit (the demo only needs
 * depth for sizing). The effective resolution is still capped by the native
 * WebXR depth buffer; `depthAt` bilinearly interpolates this grid.
 */
const QR_DEPTH_CONFIG = { gridSize: 64, intervalMs: 250, rgb: false };

/**
 * The PRE-fix front end for the `?qrperf=1&baseline=1` A/B run: the same
 * native detector, but the frame is copied once more per decode, exactly as
 * the framework did before QR perf plan M3. `onCopyMs` receives each copy's
 * duration, so the saving is measured directly. `null` without
 * `BarcodeDetector`.
 */
function createCopyingFrontEnd(
  onCopyMs?: (ms: number) => void,
): BarcodeDetectorFrontEnd | null {
  return createBarcodeDetectorFrontEnd(undefined, (image) => {
    const t0 = performance.now();
    const copy = new Uint8ClampedArray(image.data);
    onCopyMs?.(performance.now() - t0);
    return new ImageData(copy, image.width, image.height);
  });
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
    // Depth + QR-frame callbacks ride into the framework initAR as its
    // `callbacks` groups (the framework creates the depth sampler and the QR
    // frame source inside it). The camera-frame path delivers top-left RGBA
    // directly (B2) — no JPEG round-trip; each throttled frame is forwarded
    // to the active consumer.
    await initAR(
      container,
      {
        enableCameraAccess: true,
        enableDepthSensingFeature: true,
        enableCameraTextureAcquisition: true,
      },
      {},
      {
        depth: {
          onCaptured: (sample) => {
            latestDepthSample = sample;
          },
        },
        cameraFrame: {
          onFrame: (frame) => qrFrameConsumer?.(frame),
        },
      },
    );
    startDepthCapture(QR_DEPTH_CONFIG);
  },
  async endARSession(): Promise<void> {
    stopDepthCapture();
    stopCameraFrameCapture();
    qrFrameConsumer = null;
    latestDepthSample = null;
    await endARSession();
  },
  getArWorldGroup,
  createDetect(options) {
    const frontEnd = options?.copyPixels
      ? createCopyingFrontEnd(options.onCopyMs)
      : createBarcodeDetectorFrontEnd();
    if (!frontEnd) return () => Promise.resolve(null);
    return (image) => frontEnd.detect(image);
  },
  getDepthContext(): DepthContext | null {
    const sample = latestDepthSample;
    if (!sample?.projectionMatrix) return null;
    // The shared framework factory builds the unprojector + bilinear grid lookup
    // (WS-A: depth varies smoothly across a small QR face, not nearest-node) —
    // the SAME piece the Recorder's as-of resolver uses, so the two apps can't
    // diverge. The demo adds the PnP-only extras (camera pose + projection).
    const base = createQrSizeDepthContext(sample);
    if (!base) return null;
    return {
      ...base,
      projectionMatrix: sample.projectionMatrix,
    };
  },
  startFrameSource(
    onFrame: (frame: CapturedCameraFrame) => void,
    options?: FrameSourceOptions,
  ): () => void {
    // The framework camera-frame callback (wired in initAR) forwards frames to
    // whatever consumer is active. Point it at this controller and start the
    // throttled capture — the source is the single cadence owner (Option A).
    qrFrameConsumer = onFrame;
    // WS-C: allow a device tester to sweep the RGB capture resolution via
    // `?capture=<px>` (no rebuild). Absent → the framework default (1024, raised
    // from 512 by the 2026-06-17 on-device sweep).
    const captureSize =
      typeof window !== "undefined"
        ? parseCaptureSizeParam(window.location.search)
        : undefined;
    const captureConfig: CameraFrameCaptureConfig = {};
    if (options?.intervalMs !== undefined)
      captureConfig.intervalMs = options.intervalMs;
    if (options?.onCaptureTiming)
      captureConfig.onCaptureTiming = options.onCaptureTiming;
    if (options?.wantsFrame) captureConfig.wantsFrame = options.wantsFrame;
    if (captureSize !== undefined) captureConfig.captureSize = captureSize;
    startCameraFrameCapture(
      Object.keys(captureConfig).length > 0 ? captureConfig : undefined,
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
