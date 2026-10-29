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

import type { SurfacePoint } from "gps-plus-slam-app-framework/ar/hit-test-reticle-driver";
import type { DepthSampleStore } from "gps-plus-slam-app-framework/state/replay-occupancy-subscriber";
import { createMeshSurface, type MeshSurface } from "./mesh-surface.js";
import {
  getArWorldGroup,
  getCamera,
  getCurrentArPose,
  getRenderer,
  getScene,
  rgbaImageToJpegBlob,
  startCameraFrameCapture,
  startDepthCapture,
  startHitTestReticle,
  startXrSelectListener,
  stopCameraFrameCapture,
  stopDepthCapture,
  type EnableGpsArDeps,
  type HitTestReticleHandle,
  type SelectTargetRay,
} from "gps-plus-slam-app-framework/ar";
import { createWayfindingHud } from "gps-plus-slam-app-framework/visualization/wayfinding-hud";
import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-targets";
import {
  createBarcodeDetectorFrontEnd,
  type QrFrontEnd,
  type RgbaImage,
} from "gps-plus-slam-app-framework/ar/qr/qr-frontend";
import {
  intrinsicsFromProjection,
  solveQrPose,
  type CameraIntrinsics,
  type QrPoseSolution,
} from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { QrSolvePoseInput } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import {
  estimateQrSizeFromParallax,
  type QrFusedEntry,
  type QrParallaxSizeWindow,
} from "gps-plus-slam-app-framework/ar/qr";
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
  shareOrDownloadBlob,
  prefersFileShare,
  ZIP_FILE_TYPE,
  type ShareOrDownloadResult,
  PDF_FILE_TYPE,
} from "gps-plus-slam-app-framework/storage";
import type { DepthSamplerConfig } from "gps-plus-slam-app-framework/ar/depth-sampler";
import type { Camera, Object3D } from "three";

import { loadGlbModel } from "./glb-model.js";
import { ndcOfTargetRay, pickObject } from "./object-pick.js";
import { createPinLabel } from "./pin-label.js";
import type { AudioElementLike } from "./scene-audio.js";
import { HUD_ARRIVAL_BAND_M, HUD_ARRIVAL_MIN_M } from "./station-bands.js";
import { WALK_HUD_LOOKS, type WalkHudLook } from "./walk-hud.js";

import type {
  LocationPermission,
  LocationRequestOutcome,
} from "./visitor-screen.js";

/** The device functions a Playwright e2e fake may override. */
/** A browser tab opened for a PDF before it is built (`openPdfTab`). */
export interface PdfTab {
  /** Show the built PDF in the tab. */
  show(blob: Blob): void;
  /** The build failed: the empty tab goes away. */
  close(): void;
}

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
  /** Start / stop the depth sampler of a recorded entry (the sampler
   *  exists only when the entry asked for depth). */
  startDepthCapture(config: Partial<DepthSamplerConfig>): void;
  stopDepthCapture(): void;
  /** BarcodeDetector-backed detect+decode, or `null` where unavailable
   *  (desktop Chromium — there is no fallback detector by design). */
  createQrFrontEnd(): QrFrontEnd | null;
  /** The planar-PnP square solver (pure JS, OpenCV-free). */
  solveQrPose(input: QrSolvePoseInput): QrPoseSolution | null;
  /**
   * The printed code's size from parallax over a code's entries (QR size
   * consensus plan S3a) - a seam because the e2e fakes deliver one camera
   * pose, which carries no parallax, and the offer's layout must be tested.
   */
  estimateQrPrintSize(
    entries: readonly QrFusedEntry[],
  ): QrParallaxSizeWindow | null;
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
  /** The latest AR pose - what each device GPS fix is paired with
   *  (`createGpsPositionHandler`'s `getArPose`). A seam so the e2e, which
   *  has no XR frames, can deliver GPS fixes through the page's own path
   *  (Tour Viewer authoring plan 2026-09-28-0953 D20, M5c). */
  getArPose(): ReturnType<typeof getCurrentArPose>;
  /** The geolocation permission state, "unknown" without the Permissions
   *  API - the visitor screen's location gate reads it once at boot. */
  queryGeolocationPermission(): Promise<LocationPermission>;
  /** One position request on its own tap (the gate's first step):
   *  "granted" when a position arrived, "denied" when the permission was
   *  refused, "unavailable" when the permission is fine but no fix came
   *  (indoors, a courtyard, a timeout) - the session's own watch copes
   *  with that, so it must not lock the visitor out (M2 review #1). */
  requestLocationOnce(): Promise<LocationRequestOutcome>;
  /**
   * Offer a zip: the device share sheet where the browser can share FILES,
   * else the framework's save-picker-or-anchor. `route` decides the copy -
   * a share creates a NEW file (new id, new link) while a save replaces
   * one - and `delivered` says whether anything left the page at all. The
   * e2e fake captures the blob instead.
   */
  shareOrDownloadZip(
    blob: Blob,
    filename: string,
  ): Promise<ShareOrDownloadResult>;
  /** SAVE a zip, never share it: a Drive-hosted tour's route (Drive
   *  replace plan §2 decision 4) - the Drive website's upload needs the
   *  file in Downloads, and a share hands it to another app. Resolves
   *  whether anything was saved (false: a dismissed save picker). */
  downloadZip(blob: Blob, filename: string): Promise<boolean>;
  /** Should this device get the share sheet rather than the save path?
   *  Read once at wire time to label the button, because "Share" where
   *  nothing can be shared is a lie and "Download" on a phone that will
   *  open a share sheet describes the wrong action. NOT the raw
   *  capability: a desktop can share files and should still get the save
   *  picker, because the creator's next step needs the file on disk. */
  canShareZip(): boolean;
  /** The printable sheet of numbered codes. Its own seam so the save
   *  picker offers a PDF filter rather than a zip one, and so the e2e
   *  captures the bytes instead of writing a file. */
  downloadPdf(blob: Blob, filename: string): Promise<boolean>;
  /** A browser tab for the PDF where the browser shows PDFs itself
   *  (`navigator.pdfViewerEnabled`), opened NOW - inside the tap, as a
   *  pop-up blocker requires - and filled once the PDF is built (polish
   *  round M0b). Null where the browser cannot show a PDF (most phones) or
   *  blocked the tab: the PDF is then downloaded. */
  openPdfTab(): PdfTab | null;
  /** Put text on the clipboard (step 6's Drive address, polish round M2);
   *  rejects where the browser refuses. A seam so the e2e reads what was
   *  copied without clipboard permissions. */
  copyText(text: string): Promise<void>;
  /** The screen-centre hit-test reticle under the world group (its world
   *  position is GPS-world NUE once the group carries the alignment) -
   *  the pin's position (guided-setup plan M4). Needs the session feature
   *  (`requestHitTest`). `onSelect` hears every XR `select` the DOM
   *  overlay did not cancel (a tap in AR, authoring plan 2026-09-28-0953
   *  M4) through the framework driver's own option. */
  startHitTestReticle(
    arWorldGroup: Object3D,
    onSelect?: (tap: SelectTargetRay | null) => void,
    /** A surface point from the app's mesh, preferred over the hit-test
     *  each frame (polish round M5, the mesh cursor). */
    surfacePick?: () => SurfacePoint | null,
  ): HitTestReticleHandle;
  /** The surroundings as a mesh for the creator's cursor (polish round M5,
   *  off with `?mesh=0`): fed from the store's depth samples, meshed in a worker
   *  under `parent` (`mesh-surface.ts`). A seam because the e2e scene has
   *  no depth to mesh. */
  startMeshSurface(parent: Object3D, store: DepthSampleStore): MeshSurface;
  /** Hear every XR `select` (a tap in AR the overlay did not cancel)
   *  with its target ray, without a reticle - the visitor's pin taps
   *  (station blocks plan B2b). A seam so the e2e taps (`tapXr`). */
  startXrSelect(onSelect: (tap: SelectTargetRay | null) => void): {
    dispose(): void;
  };
  /** The id of the object under the tap - through the tap's target ray,
   *  or the screen centre when `tap` is null - by a camera-ray raycast
   *  against each object's rendered root with an angular tolerance
   *  (`object-pick.ts`), or null. A seam because the e2e scene is a stub
   *  with no geometry to hit. */
  pickObjectInView(
    targets: ReadonlyMap<string, Object3D>,
    tap: SelectTargetRay | null,
  ): string | null;
  /** Encode a camera frame (top-left RGBA) as a JPEG for a placed photo.
   *  Rejects when the frame is not opaque: the canvas would composite it
   *  over its ground and the JPEG would come out dark (plan review #15). */
  encodeFrameJpeg(image: RgbaImage): Promise<CapturedJpeg>;
  /** A pin's label: the framework's text sprite (a canvas, so a seam - node
   *  has none). */
  createLabel(text: string): { object: Object3D; dispose(): void };
  /** A one-shot clock (the scan gate's escape, DEC-N3): returns the
   *  cancel. A seam so the e2e fires it instead of waiting for it. */
  schedule(fn: () => void, ms: number): () => void;
  /**
   * The wayfinding HUD over the session camera (tour kit plan K4: the
   * arrow to the offered stations), or null while there is no camera. Each
   * target carries its own arrival band (`station-bands.ts`). A seam: the
   * e2e has no camera, and asserts the targets instead.
   */
  createWayfindingHud(options: {
    getTargets: () => WayfindingTarget[];
    /** The walk's two looks (`walk-hud.ts`): the focus in the walk's
     *  orange at 1.25 times the size, the others in its white; without
     *  one, the framework's accent at its size. */
    look?: WalkHudLook;
  }): { dispose(): void } | null;
  /** A station's `.glb` (already checked inert by the tour session, K0's
   *  `checkGlbInert`) as a three scene: three's GLTFLoader, loaded on first
   *  use, with no external URIs and no decoders. */
  loadGlbModel(blob: Blob): Promise<Object3D>;
  /** The camera the visitor sees through (where a model's notes are
   *  projected), or null outside a session. */
  getViewerCamera(): Camera | null;
  /** Switch the renderer's local clipping on: a cutaway model clips its
   *  materials by a plane. Does nothing without a renderer. */
  enableClipping(): void;
  /** The page's one audio element for the stories (unlocked by the start
   *  tap, `scene-audio.ts`). A seam so the e2e records what played. */
  createAudioElement(): AudioElementLike;
  /** The session camera's `P[0]` (`2*atan(1/P[0])` is its horizontal
   *  field of view: the radar's view cone),
   *  or null while there is no camera. WebXR owns that projection during
   *  an immersive session (`getIntrinsics`' precedent). A seam: the e2e
   *  has no camera, and the radar draws its fallback cone. */
  xrProjection0(): number | null;
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
  startDepthCapture,
  stopDepthCapture,
  createQrFrontEnd: () => createBarcodeDetectorFrontEnd(),
  solveQrPose: (input) => solveQrPose({ ...input, solver: pnpSolver }),
  estimateQrPrintSize: (entries) => estimateQrSizeFromParallax(entries),
  // The QR pipelines never use depth (QD-5; a creator's depth feeds only
  // the mesh cursor and the recording, and a visitor's is off unless
  // recorded), so the projection comes from the
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
  getArPose: getCurrentArPose,
  shareOrDownloadZip: (blob, filename) =>
    shareOrDownloadBlob(blob, filename, ZIP_FILE_TYPE),
  downloadZip: (blob, filename) => downloadBlob(blob, filename, ZIP_FILE_TYPE),
  canShareZip: () => prefersFileShare(ZIP_FILE_TYPE),
  downloadPdf: (blob, filename) => downloadBlob(blob, filename, PDF_FILE_TYPE),
  openPdfTab: () => {
    if (navigator.pdfViewerEnabled !== true) return null;
    const tab = window.open("", "_blank");
    if (tab === null) return null;
    return {
      show: (blob) => {
        // The URL outlives this call on purpose: the tab is still reading
        // it. One per PDF built, released with the page.
        tab.location.href = URL.createObjectURL(blob);
      },
      close: () => {
        tab.close();
      },
    };
  },
  copyText: (text) => navigator.clipboard.writeText(text),
  startHitTestReticle: (arWorldGroup, onSelect, surfacePick) =>
    startHitTestReticle({
      arWorldGroup,
      ...(surfacePick === undefined ? {} : { surfacePick }),
      ...(onSelect === undefined
        ? {}
        : {
            // The driver's second argument is where the tap pointed
            // (M4 review #4); its first, the reticle's surface point, is
            // not what a selection is about.
            onSelect: (_surface: unknown, tap: SelectTargetRay | null) => {
              onSelect(tap);
            },
          }),
    }),
  startMeshSurface: (parent, store) =>
    createMeshSurface({
      parent,
      store,
      getCamera: () => getCamera(),
      createWorker: () =>
        new Worker(
          new URL("./workers/occlusion-mesher.worker.ts", import.meta.url),
          { type: "module" },
        ),
    }),
  startXrSelect: (onSelect) => startXrSelectListener(onSelect),
  pickObjectInView: (targets, tap) => {
    const camera = getCamera();
    if (!camera) return null;
    const ndc =
      tap === null ? null : ndcOfTargetRay(camera, tap.targetRayInViewer);
    return pickObject(camera, targets, ndc === null ? {} : { ndc });
  },
  schedule: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => {
      clearTimeout(handle);
    };
  },
  encodeFrameJpeg: (image) => encodeRgbaAsJpeg(image),
  createWayfindingHud: ({ getTargets, look }) => {
    const camera = getCamera();
    if (!camera) return null;
    return createWayfindingHud({
      camera,
      getTargets,
      // Each station target carries its own band; these are the floors.
      distanceMin: HUD_ARRIVAL_MIN_M,
      distanceMax: HUD_ARRIVAL_MIN_M + HUD_ARRIVAL_BAND_M,
      ...(look === undefined ? {} : WALK_HUD_LOOKS[look]),
    });
  },
  loadGlbModel,
  getViewerCamera: () => getCamera(),
  enableClipping: () => {
    const renderer = getRenderer();
    if (renderer) renderer.localClippingEnabled = true;
  },
  createAudioElement: () => new Audio(),
  xrProjection0: () => getCamera()?.projectionMatrix.elements[0] ?? null,
  // The one recipe the 3D editor shares (`pin-label.ts`).
  createLabel: createPinLabel,
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
