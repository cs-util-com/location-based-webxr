/**
 * Device seam (DEV-overridable) for the TourViewer's AR modes.
 *
 * `main.ts` stays glue-only: it composes the tested modules (`ar-mode`,
 * `mode`, the tour session) with the device-specific framework
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
  rgbaImageToJpegBlob,
  startCameraFrameCapture,
  startHitTestReticle,
  stopCameraFrameCapture,
  type EnableGpsArDeps,
  type HitTestReticleHandle,
} from "gps-plus-slam-app-framework/ar";
import { createTextSprite } from "gps-plus-slam-app-framework/visualization/text-sprite";
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
import {
  downloadBlob,
  downloadZip,
  PDF_FILE_TYPE,
} from "gps-plus-slam-app-framework/storage";
import type { Object3D } from "three";

import type {
  LocationPermission,
  LocationRequestOutcome,
} from "./visitor-screen.js";

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
  /** The geolocation permission state, "unknown" without the Permissions
   *  API - the visitor screen's location gate reads it once at boot. */
  queryGeolocationPermission(): Promise<LocationPermission>;
  /** One position request on its own tap (the gate's first step):
   *  "granted" when a position arrived, "denied" when the permission was
   *  refused, "unavailable" when the permission is fine but no fix came
   *  (indoors, a courtyard, a timeout) - the session's own watch copes
   *  with that, so it must not lock the visitor out (M2 review #1). */
  requestLocationOnce(): Promise<LocationRequestOutcome>;
  /** Offer a zip for download (the framework's picker-or-anchor); false
   *  when the user dismissed a save picker. The e2e fake captures the
   *  blob instead. */
  downloadZip(blob: Blob, filename: string): Promise<boolean>;
  /** The printable sheet of numbered codes. Its own seam so the save
   *  picker offers a PDF filter rather than a zip one, and so the e2e
   *  captures the bytes instead of writing a file. */
  downloadPdf(blob: Blob, filename: string): Promise<boolean>;
  /** The screen-centre hit-test reticle under the world group (its world
   *  position is GPS-world NUE once the group carries the alignment) -
   *  the pin's position (guided-setup plan M4). Needs the session feature
   *  (`requestHitTest`). */
  startHitTestReticle(arWorldGroup: Object3D): HitTestReticleHandle;
  /** Encode a camera frame (top-left RGBA) as a JPEG for a placed photo.
   *  Rejects when the frame is not opaque: the canvas would composite it
   *  over its ground and the JPEG would come out dark (plan review #15). */
  encodeFrameJpeg(image: RgbaImage): Promise<CapturedJpeg>;
  /** A pin's label: the framework's text sprite (a canvas, so a seam - node
   *  has none). */
  createLabel(text: string): { object: Object3D; dispose(): void };
  /** A one-shot clock (the scan gate's escape, DEC-N3): returns the
   *  cancel. A seam so the e2e fires it instead of waiting 45 s. */
  schedule(fn: () => void, ms: number): () => void;
}

/** A captured photo, encoded. */
interface CapturedJpeg {
  blob: Blob;
  width: number;
  height: number;
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
  downloadZip,
  downloadPdf: (blob, filename) => downloadBlob(blob, filename, PDF_FILE_TYPE),
  startHitTestReticle: (arWorldGroup) => startHitTestReticle({ arWorldGroup }),
  schedule: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => {
      clearTimeout(handle);
    };
  },
  encodeFrameJpeg: (image) => encodeRgbaAsJpeg(image),
  createLabel: (text) => {
    // A canvas wide enough for a short label at a readable size, the sprite
    // scaled to the same 2:1 aspect (the wayfinding HUD's recipe); the
    // defaults (a 64 px square, a 48 px glyph) are for single characters
    // and clipped every word (M4 review #5). Transparent, no depth write:
    // the pill's surround must not paint a black square over the camera.
    const sprite = createTextSprite({
      text,
      background: "pill",
      canvasWidth: 512,
      canvasHeight: 256,
      font: "bold 56px sans-serif",
      transparent: true,
      depthWrite: false,
      scale: { x: 0.6, y: 0.3, z: 1 },
    });
    return { object: sprite.sprite, dispose: () => sprite.dispose() };
  },
  queryGeolocationPermission: async () => {
    try {
      const status = await navigator.permissions.query({
        name: "geolocation",
      });
      return status.state;
    } catch {
      return "unknown";
    }
  },
  requestLocationOnce: () =>
    new Promise<LocationRequestOutcome>((resolve) => {
      if (!("geolocation" in navigator)) {
        resolve("unavailable");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        () => {
          resolve("granted");
        },
        (err) => {
          // PERMISSION_DENIED is 1; anything else is a position problem.
          resolve(err.code === 1 ? "denied" : "unavailable");
        },
        // A cached fix is fine: the tap only needs the PERMISSION settled
        // before the session's own watch starts.
        { timeout: 15_000, maximumAge: 60_000 },
      );
    }),
};

/** JPEG quality for a placed photo. The framework's capture default is
 *  0.7 and the recorder configures 0.8; a placed photo is a hero image
 *  seen up close, so it sits above both. */
const PHOTO_JPEG_QUALITY = 0.85;

/**
 * The detector frame (1024 px long edge, top-left origin RGBA) as a JPEG,
 * through the framework's encoder (`rgbaImageToJpegBlob`, the one behind
 * the blit capture - DEC-H3, M4 review #14). The alpha channel is sampled
 * first: a frame that is not opaque would be composited over the canvas
 * ground and come out dark, which is the one failure a creator cannot see
 * until the visitor does. Async throughout: nothing here throws
 * synchronously into a click handler (M4 review #11).
 */
async function encodeRgbaAsJpeg(image: RgbaImage): Promise<CapturedJpeg> {
  const { data, width, height } = image;
  if (width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new Error("camera frame is empty or malformed");
  }
  for (let i = 3; i < data.length; i += Math.max(4, (data.length >> 4) & ~3)) {
    if (data[i] !== 255) {
      throw new Error(
        "camera frame is not opaque; refusing to encode a dark photo",
      );
    }
  }
  const blob = await rgbaImageToJpegBlob(image, PHOTO_JPEG_QUALITY);
  if (blob === null) throw new Error("JPEG encoding failed");
  return { blob, width, height };
}

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
