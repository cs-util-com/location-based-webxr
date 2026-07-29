/**
 * WebXR Session Module
 *
 * Handles WebXR AR session initialization and frame loop.
 *
 * ARCHITECTURE NOTE: See docs/architecture-ar-gps-pose-separation.md
 *
 * Scene Hierarchy:
 *   scene (GPS world frame — NUE: X=North, Y=Up, Z=East)
 *   └── arWorldGroup (local space = NUE; receives alignment matrix)
 *       └── basisChangeNode ('webxr-to-nue', constant WEBXR_TO_NUE matrix)
 *           └── arpose (local space = WebXR)
 *               └── camera (raw AR pose from WebXR)
 *
 * The arWorldGroup is transformed by the GpsPlusSlamJs alignment matrix.
 * The camera's LOCAL transform is the raw AR pose from WebXR.
 * The camera's WORLD transform is the GPS-aligned world pose.
 */

import * as THREE from 'three';
import { createLogger } from '../utils/logger';
import { applyChromiumProjectionLayerWorkaround } from './chromium-camera-access-workaround';
import { probeImmersiveArSupport } from './webxr-support-probe';
import { createSceneHierarchy } from './ar-scene-hierarchy';
import {
  ImageCaptureManager,
  type ImageCaptureCallbacks,
  type CapturedImage,
  type CapturedFrame,
  type FrameQualityVerdict,
  type ImageCaptureConfig,
  DEFAULT_CAPTURE_CONFIG,
} from './image-capture';
import {
  poseReceived as poseReceivedAction,
  poseLost as poseLostAction,
  originReset as originResetAction,
  resetTracking as resetTrackingAction,
  clearLastRestartedPayload as clearLastRestartedPayloadAction,
  selectTrackingPhase,
  selectLastRestartedPayload,
  type TrackingPhase,
  type TrackingSliceState,
  type ResetTransformData,
} from '../state/tracking-slice';

/**
 * Minimal subscribable-store contract the tracking pipeline needs:
 * dispatch the slice actions, read the slice for the restart payload, and
 * subscribe to phase transitions. Structurally compatible with the full
 * `SlamAppStore` (and any test double) without coupling this module to the
 * factory's exact generics.
 */
export interface TrackingSubscribableStore {
  dispatch: (action: { type: string; payload?: unknown }) => unknown;
  getState: () => { tracking: TrackingSliceState };
  subscribe: (listener: () => void) => () => void;
}
import {
  DepthSampler,
  wrapXRDepthInfo,
  type DepthSamplerCallbacks,
  type DepthSamplerConfig,
  type DepthSample,
  type DepthInfo,
} from './depth-sampler';
import {
  CameraBlitCapture,
  computeCaptureSize,
  computeAspectFitSize,
} from './camera-blit-capture';
import { CameraFrameSource } from './camera-frame-source';
import type { RgbaImage } from './qr/qr-frontend';
import { createRgbLookup, type RgbLookup } from './depth-rgb-lookup';
import { acquireCameraTexture } from './xr-camera-texture';
import { clearFrameUpdates, runFrameUpdates } from './frame-loop';
import { runSessionDisposers } from './session-disposers';
import { clearXrFrameUpdates, runXrFrameUpdates } from './xr-frame-loop';
import {
  type OdometryTrackingRestartedPayload,
  nueToWebXR as _nueToWebXR,
  nueQuaternionToWebXR as _nueQuaternionToWebXR,
} from 'gps-plus-slam-js';
import type { ARPose } from '../types/ar-types';
import { getLastDeviceOrientation } from '../sensors/device-orientation-cache';
import {
  DEFAULT_AR_CRASH_ISOLATION,
  type ArCrashIsolationOptions,
  validateArCrashIsolationOptions,
} from './ar-crash-isolation';
import {
  createCss3dRendererManager,
  type Css3dRendererManager,
} from '../visualization/css3d-renderer-manager.js';
import type { XRCameraLike } from './xr-camera-texture';

// Re-export types for consumers
export type { CapturedImage } from './image-capture';
export type { DepthSample } from './depth-sampler';
export type { ARPose } from '../types/ar-types';

const log = createLogger('WebXR');

// ---------------------------------------------------------------------------
// Exported for unit testing only
//
// The five pure helpers in this block are internal building blocks of the XR
// frame loop / session wiring — no production code outside this module
// imports them, and they are deliberately NOT re-exported by the ar/ barrel.
// They stay `export`ed so `webxr-session.test.ts` can pin their contracts
// directly (2026-07-11 surface-reduction step 3, matching the documented
// test-only-export precedent from the 2026-07-10 quality review, B-5). If one
// of them ever gains a production consumer, move it out of this block and add
// it to the barrel.
// ---------------------------------------------------------------------------

/** Runtime guard for `XRView.camera` candidates (finite, positive dimensions). */
export function isXRCameraLike(value: unknown): value is XRCameraLike {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const camera = value as { width?: unknown; height?: unknown };
  return (
    typeof camera.width === 'number' &&
    Number.isFinite(camera.width) &&
    camera.width > 0 &&
    typeof camera.height === 'number' &&
    Number.isFinite(camera.height) &&
    camera.height > 0
  );
}

/**
 * Extract a validated XRCameraLike from an XRViewerPose.
 *
 * Returns null in every case where the per-frame texture acquisition must be
 * skipped — i.e. whenever the caller should treat any previously cached
 * texture as stale and clear it. Centralising the preconditions here makes
 * it impossible to accidentally fall through without clearing the cache.
 *
 * Cases that return null:
 *   - pose is null (tracking lost)
 *   - pose has no views
 *   - the first view has no `camera` property (camera-access not granted)
 *   - the camera property is not a valid XRCameraLike (zero/NaN dimensions)
 *
 * @see docs/2026-02-06-bug-camera-frames-black.md
 */
export function getXrCameraFromPose(
  pose: XRViewerPose | null
): XRCameraLike | null {
  if (!pose) {
    return null;
  }
  const view = pose.views[0];
  if (!view) {
    return null;
  }
  const candidate = (view as { camera?: unknown }).camera;
  return isXRCameraLike(candidate) ? candidate : null;
}

/**
 * Decide whether the one-time camera-access grant diagnostic should fire
 * on the current XR frame.
 *
 * The diagnostic is only meaningful when we actually have a valid pose:
 * if `pose` is null (e.g. session starts with tracking lost), then the
 * derived `xrCamera` is null regardless of permission state, and logging
 * "NOT GRANTED" would be a false negative that permanently suppresses the
 * correct status because `cameraAccessLoggedOnce` would latch to true.
 *
 * Additional conditions:
 *   - `alreadyLogged` prevents spamming the log every frame.
 *   - `captureActive` ensures we only care when an image capture session
 *     is running (otherwise the diagnostic has no audience).
 *
 * This predicate is extracted as a pure function so the guard against the
 * "first frame has no pose" false-negative regression is directly testable.
 */
export function shouldLogCameraAccessDiagnostic(
  pose: XRViewerPose | null,
  alreadyLogged: boolean,
  captureActive: boolean
): boolean {
  return pose !== null && !alreadyLogged && captureActive;
}

/**
 * Extract the reset transform from an XRReferenceSpaceEvent-like object.
 *
 * Distinguishes three cases per OdometryTrackingRestartedPayload semantics:
 * - Transform property missing (older browsers) → returns `undefined`
 * - Transform property present but null (runtime can't determine delta) → returns `null`
 * - Transform property present with data → returns `ResetTransformData`
 *
 * This is a pure function extracted for testability.
 *
 * @param event - The event object, cast to a record with an optional transform property
 * @returns ResetTransformData, null, or undefined
 */
export function extractResetTransformData(
  event: Record<string, unknown>
): ResetTransformData | null | undefined {
  if (!('transform' in event)) {
    return undefined;
  }
  const transform = event.transform as {
    position: DOMPointReadOnly;
    orientation: DOMPointReadOnly;
  } | null;
  if (!transform) {
    return null;
  }
  const pos = transform.position;
  const ori = transform.orientation;
  return {
    position: [pos.x, pos.y, pos.z],
    orientation: [ori.x, ori.y, ori.z, ori.w],
  };
}

/**
 * Extract pose data from an XRViewerPose.
 * Returns null if pose or views are unavailable.
 *
 * This is a pure function extracted for testability.
 *
 * @param pose - The XRViewerPose from frame.getViewerPose()
 * @returns ARPose with position and orientation, or null
 */
export function extractPoseFromViewer(
  pose: XRViewerPose | null
): ARPose | null {
  if (!pose) {
    return null;
  }

  const view = pose.views[0];
  if (!view) {
    return null;
  }

  const { position, orientation } = view.transform;

  return {
    position: { x: position.x, y: position.y, z: position.z },
    orientation: {
      x: orientation.x,
      y: orientation.y,
      z: orientation.z,
      w: orientation.w,
    },
  };
}

// ------------------------- (end test-only exports) -------------------------

/**
 * Default longer-edge resolution (px) for the camera-frame blit the QR / CV
 * detector sees. The on-device capture-resolution sweep (2026-06-17, via the
 * `?capture=` override) showed **1024** decodes a small / out-of-focus QR
 * markedly better than the prior 512 with no perceptible cadence cost on the
 * test phone; 2048 helped slightly more but risks low-end devices (4096 lagged),
 * so 1024 is the safe default. Raise per-consumer via
 * `startCameraFrameCapture({ captureSize })`.
 *
 * (Declared above the handle factory because the factory runs at module
 * evaluation — a later `const` would still be in its temporal dead zone.)
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-06-17-1020-qr-size-accuracy-and-thin-demo-plan.md (WS-C)
 */
export const DEFAULT_CAMERA_FRAME_CAPTURE_SIZE = 1024;

/**
 * Per-session state owned by one AR session — Stages 0–3 of the staged
 * ArSession refactor (see `GpsPlusSlamJs_Docs/docs/2026-07-18-2045-webxr-session-arsession-handle-refactor-plan.md`).
 * A fresh handle is created by `initAR()` (parameterized with this session's
 * crash-isolation options and callbacks struct) and by `resetWebXRState()`
 * (so pre-init and post-teardown reads see well-defined defaults) — replacing
 * a field-by-field reset for everything in here. Since Stage 3 EVERY
 * per-session cluster lives here: `activeSession` is the module's single
 * remaining mutable, so new session state added to this interface is reset
 * (and, where needed, disposed) by the wholesale handle replacement — the
 * "add a field, forget the reset" leak class is structurally gone.
 */
interface ArSessionHandle {
  /**
   * The live Three.js scene graph + renderer (Stage 3). All null until
   * `initAR()` builds them (renderer first, then the hierarchy from
   * `createSceneHierarchy()`), and null again after teardown — the public
   * getters (`getScene`/`getCamera`/`getArWorldGroup`) surface exactly that
   * null-before-init / null-after-teardown contract.
   */
  sceneGraph: {
    renderer: THREE.WebGLRenderer | null;
    scene: THREE.Scene | null;
    /**
     * Camera INSIDE the arpose node — its local transform is the raw WebXR
     * pose during recording (see `createSceneHierarchy()`).
     */
    camera: THREE.PerspectiveCamera | null;
    /**
     * The AR world group — parent of camera and all AR-tracked content.
     * This group's transform = the alignment matrix from GpsPlusSlamJs
     * (see {@link applyAlignmentMatrix}).
     */
    arWorldGroup: THREE.Group | null;
    /**
     * CSS3D renderer manager for DOM-based 3D objects (e.g. the Leaflet
     * map) rendered alongside WebGL. Created by `initAR()` when the
     * `enableCss3dRenderer` isolation flag is on.
     */
    css3d: Css3dRendererManager | null;
  };
  /** The live XRSession between `initAR()` and teardown (Stage 3). */
  xrSession: XRSession | null;
  /**
   * Latest raw AR pose from WebXR, updated every frame (Stage 3). Read by
   * the GPS callback via {@link getCurrentArPose} to create paired GPS+AR
   * events; nulled while tracking is lost so stale poses never pair.
   */
  latestArPose: ARPose | null;
  /**
   * Per-frame host callback (initAR `callbacks.onFrame`), invoked every XR
   * frame after pose updates but before render (Stage 3).
   */
  onFrame: (() => void) | null;
  /**
   * Periodic JPEG image capture (Stage 1). Callback slots arrive via initAR
   * `callbacks.imageCapture`; `manager`/`blit` are created by
   * `startImageCapture()` and disposed by `stopImageCapture()`/teardown.
   */
  imageCapture: {
    manager: ImageCaptureManager | null;
    /** JPEG blit pipeline for WebXR opaque camera textures. */
    blit: CameraBlitCapture | null;
    onCaptured: ((image: CapturedImage) => void) | null;
    /** Returns current device screen rotation (0, 90, 180, 270). */
    getScreenRotation: (() => number) | null;
    onFailed: (() => void) | null;
    onSuspicious: ((blobSize: number, frameIndex: number) => void) | null;
    /**
     * Off-thread image-quality analyzer (device-specific — a Web Worker in
     * the recorder — so it is INJECTED, never built here). Forwarded to
     * `ImageCaptureManager` as its `analyzeFrame` callback; only invoked when
     * `config.qualityFilter.enabled`. `null` ⇒ the legacy save-immediately
     * path. Per-session: the host re-passes it with each initAR.
     */
    qualityAnalyzer:
      | ((frame: CapturedFrame) => Promise<FrameQualityVerdict>)
      | null;
  };
  /**
   * Depth sampling (Stage 1). `sampler` is created by `initAR` when the
   * `depth` callbacks group is passed; `rgbBlit` is the dedicated small
   * 256×192 blit for per-sample RGB lookups (lazy — no GPU allocation when
   * the rgb option is off).
   */
  depth: {
    sampler: DepthSampler | null;
    rgbBlit: CameraBlitCapture | null;
    onCaptured: ((sample: DepthSample) => void) | null;
    onUnavailable: (() => void) | null;
  };
  /**
   * Throttled camera RGBA frames for CV (Stage 1). `source` is created by
   * `initAR` when the `cameraFrame` callbacks group is passed; `blit` is the
   * session-owned aspect-preserving blit (lazy, longer edge = `captureSize`).
   */
  cameraFrame: {
    source: CameraFrameSource | null;
    blit: CameraBlitCapture | null;
    /** Longer-edge resolution (px) of the camera-frame blit. */
    captureSize: number;
    onFrame: ((image: RgbaImage) => void) | null;
  };
  /**
   * Tracking-state pipeline (Stage 2). Store + host callbacks arrive TOGETHER
   * via initAR `callbacks.tracking`; `phaseUnsubscribe` is the store phase
   * subscription opened by `initAR` (torn down by teardown/rebind so no
   * dangling listener outlives its store). `store` is the ONE handle field
   * mutated mid-session — {@link rebindTrackingStore}, the recorder's
   * per-recording store swap.
   */
  tracking: {
    store: TrackingSubscribableStore | null;
    phaseUnsubscribe: (() => void) | null;
    onRestarted: ((payload: OdometryTrackingRestartedPayload) => void) | null;
    onLost: (() => void) | null;
    onRecovered: (() => void) | null;
  };
  /** Crash-isolation diagnostic flags resolved for this session. */
  crashIsolation: ArCrashIsolationOptions;
  /**
   * Host callback fired exactly once whenever the XRSession ends — on BOTH
   * the app-initiated and the system-initiated path (initAR
   * `callbacks.onSessionEnd`).
   */
  onSessionEnd: ((info: SessionEndInfo) => void) | null;
  /**
   * Set by endARSession() immediately before its `xrSession.end()` so the
   * shared 'end' listener can tell the two trigger paths apart (the app's own
   * end() fires the same 'end' event the system path does). Read by
   * handleSessionEnded(); cleared with the rest of the handle on teardown
   * (also covering the case where end() rejects without the event firing).
   */
  endRequestedByApp: boolean;
  /**
   * Monotonic time of the previous XR frame, in milliseconds (XR `time`
   * argument). Starts at 0 so the first frame of a new session sees
   * `dt = 0` rather than a stale delta from the prior session.
   */
  lastFrameTime: number;
  /**
   * Latest WebXR camera texture, updated each frame when camera-access is
   * enabled (valid only within that XR frame). Acquired via Three.js's
   * renderer.xr.getCameraTexture() API (ExternalTexture).
   * @see xr-camera-texture.ts
   */
  latestCameraTexture: THREE.Texture | null;
  /**
   * Latest camera frame dimensions from XRCamera (native resolution). Used to
   * dynamically resize the blit render target for full-quality captures.
   */
  latestCameraWidth: number;
  latestCameraHeight: number;
  /** Whether the once-per-session camera-access diagnostic has been logged. */
  cameraAccessLoggedOnce: boolean;
  /** Throttle counter for the getCameraTexture()-returned-null diagnostic. */
  getCameraTextureNullCount: number;
}

/**
 * Normalize an optional callback to the handle's explicit-`null` convention
 * (also keeps `createArSessionHandle` under the lint complexity cap — each
 * inline `?? null` would count as a decision point).
 */
function orNull<T>(value: T | undefined): T | null {
  return value ?? null;
}

// Per-cluster builders — one per ArSessionCallbacks group, each with its own
// lint complexity budget (every `?.` counts as a decision point).
function createImageCaptureCluster(
  cb: ArSessionCallbacks['imageCapture']
): ArSessionHandle['imageCapture'] {
  return {
    manager: null,
    blit: null,
    onCaptured: orNull(cb?.onCaptured),
    getScreenRotation: orNull(cb?.getScreenRotation),
    onFailed: orNull(cb?.onFailed),
    onSuspicious: orNull(cb?.onSuspicious),
    qualityAnalyzer: orNull(cb?.qualityAnalyzer),
  };
}

function createDepthCluster(
  cb: ArSessionCallbacks['depth']
): ArSessionHandle['depth'] {
  return {
    sampler: null,
    rgbBlit: null,
    onCaptured: orNull(cb?.onCaptured),
    onUnavailable: orNull(cb?.onUnavailable),
  };
}

function createCameraFrameCluster(
  cb: ArSessionCallbacks['cameraFrame']
): ArSessionHandle['cameraFrame'] {
  return {
    source: null,
    blit: null,
    captureSize: DEFAULT_CAMERA_FRAME_CAPTURE_SIZE,
    onFrame: orNull(cb?.onFrame),
  };
}

function createTrackingCluster(
  cb: ArSessionCallbacks['tracking']
): ArSessionHandle['tracking'] {
  return {
    store: orNull(cb?.store),
    phaseUnsubscribe: null,
    onRestarted: orNull(cb?.onRestarted),
    onLost: orNull(cb?.onLost),
    onRecovered: orNull(cb?.onRecovered),
  };
}

function createSceneGraphCluster(): ArSessionHandle['sceneGraph'] {
  return {
    renderer: null,
    scene: null,
    camera: null,
    arWorldGroup: null,
    css3d: null,
  };
}

function createArSessionHandle(
  crashIsolation: ArCrashIsolationOptions,
  callbacks: ArSessionCallbacks
): ArSessionHandle {
  return {
    sceneGraph: createSceneGraphCluster(),
    xrSession: null,
    latestArPose: null,
    onFrame: orNull(callbacks.onFrame),
    imageCapture: createImageCaptureCluster(callbacks.imageCapture),
    depth: createDepthCluster(callbacks.depth),
    cameraFrame: createCameraFrameCluster(callbacks.cameraFrame),
    tracking: createTrackingCluster(callbacks.tracking),
    crashIsolation,
    onSessionEnd: orNull(callbacks.onSessionEnd),
    endRequestedByApp: false,
    lastFrameTime: 0,
    latestCameraTexture: null,
    latestCameraWidth: 0,
    latestCameraHeight: 0,
    cameraAccessLoggedOnce: false,
    getCameraTextureNullCount: 0,
  };
}

/** Fresh default handle for the pre-init / post-teardown state. */
function defaultArSessionHandle(): ArSessionHandle {
  return createArSessionHandle({ ...DEFAULT_AR_CRASH_ISOLATION }, {});
}

/**
 * The live session handle — the module's ONLY mutable since Stage 3. Always
 * non-null: teardown REPLACES it with a fresh default handle, so
 * pre-init/post-teardown reads need no null checks. (The plan sketched making
 * it nullable at Stage 3; the always-non-null default-handle pattern proved
 * strictly simpler — same reset guarantee, zero null-guard churn at the ~40
 * read sites.)
 */
let activeSession: ArSessionHandle = defaultArSessionHandle();

/**
 * Reset WebXR module state - exported for testing only.
 * @internal
 */
export function resetWebXRState(): void {
  // Stop render loop and dispose GPU resources before dropping references
  const { renderer } = activeSession.sceneGraph;
  if (renderer) {
    renderer.setAnimationLoop(null);
    if (renderer.domElement.parentElement) {
      renderer.domElement.parentElement.removeChild(renderer.domElement);
    }
    renderer.dispose();
  }
  clearFrameUpdates();
  clearXrFrameUpdates();
  // Flush session-scoped teardown (e.g. the store subscription opened by
  // `enableArWorldGroupAlignment`). `clearFrameUpdates` above already drops the
  // per-frame ticks; this releases the non-frame resources that would otherwise
  // outlive the session. This is the single chokepoint every restart passes
  // through, so callers never have to dispose those by hand.
  runSessionDisposers();
  // Tear down the outgoing handle's live subscription so no phase listener
  // outlives its store, then dispose its GPU-backed blits + the CSS3D
  // overlay, then replace the handle wholesale — one line resets every field
  // on it (scene graph, XR session, capture + tracking clusters incl. the
  // injected quality analyzer, callbacks, session-end pair, crash-isolation
  // options, frame diagnostics), so new handle state can never be forgotten
  // here. Hosts re-pass their callbacks on the next initAR (they own e.g.
  // the analyzer Worker). Note this never calls XRSession.end() — that is
  // endARSession()'s one unique step.
  activeSession.tracking.phaseUnsubscribe?.();
  cleanupBlitResources();
  activeSession.depth.rgbBlit?.dispose();
  activeSession.cameraFrame.blit?.dispose();
  activeSession.sceneGraph.css3d?.dispose();
  activeSession = defaultArSessionHandle();
}

// The scene graph (renderer, scene, camera, arWorldGroup, CSS3D manager),
// the XRSession, and the latest raw AR pose live on
// `activeSession.sceneGraph` / `.xrSession` / `.latestArPose` (Stage 3) —
// see the ArSessionHandle field docs.
//
// NOTE: the live session keeps NO reference to the arpose node (the
// intermediate Object3D between basisChangeNode and the camera). It stays at
// identity during recording and lives purely in the scene graph built by
// createSceneHierarchy(); its only reader was the replay-injection getter
// getArPose(), deleted by surface-reduction step 2 — replay now uses its own
// arpose from replay-scene's getReplayState().

// The image-capture cluster (manager, blit, callback slots incl. the injected
// quality analyzer) lives on `activeSession.imageCapture` (Stage 1) — see the
// ArSessionHandle field docs.

// The tracking cluster (store, phase subscription, host callbacks) lives on
// `activeSession.tracking` (Stage 2) — see the ArSessionHandle field docs.
// When the store is present, `onXRFrame` dispatches `poseReceived`/`poseLost`,
// the XR reference-space reset listener dispatches `originReset`, and a
// subscription translates phase transitions back into the host's callbacks;
// when absent the tracking pipeline simply no-ops.

/**
 * Info passed to the session-end callback (F3, 2026-07-04 user feedback).
 * `requestedByApp` discriminates the app's own `endARSession()` from a
 * system-initiated end (e.g. the Android back gesture, which ends an
 * immersive XRSession directly — no popstate, no beforeunload, not
 * cancelable).
 */
export interface SessionEndInfo {
  requestedByApp: boolean;
}

// The session-end callback + app-initiated-end discriminator live on
// `activeSession` (Stage 0) — see the ArSessionHandle field docs.

// The depth-sampling cluster (sampler, rgb blit, callbacks) lives on
// `activeSession.depth` (Stage 1) — see the ArSessionHandle field docs.

// The per-frame host callback lives on `activeSession.onFrame` (Stage 3);
// the CSS3D renderer manager on `activeSession.sceneGraph.css3d` — see the
// ArSessionHandle field docs.

// The camera-frame CV cluster (source, blit, capture size, callback) lives on
// `activeSession.cameraFrame` (Stage 1). SINGLE consumer by design: one
// source, one callback, one blit — one CV consumer at a time (QR *or* object
// detection). To run two live CV consumers simultaneously at independent
// cadences/resolutions, replace the single-callback wiring with a small
// registry (e.g. `registerCameraFrameConsumer({ intervalMs, captureSize,
// onFrame })`) holding a `CameraFrameSource` per consumer — the class is
// already per-instance. See the SCOPE note in `camera-frame-source.ts`.

/** Readback size for the depth-RGB blit (plan §5: "e.g. 256×192 suffices"). */
const DEPTH_RGB_BLIT_CONFIG = { width: 256, height: 192 };

// The per-frame camera texture/dimensions and the camera-access diagnostic
// latches live on `activeSession` (Stage 0) — see the ArSessionHandle docs.

const GET_CAMERA_TEXTURE_LOG_THRESHOLD = 5;

/**
 * Dispose the JPEG blit pipeline and clear the cached camera texture.
 * Shared by resetWebXRState() and stopImageCapture() to avoid duplication.
 */
function cleanupBlitResources(): void {
  const { imageCapture } = activeSession;
  if (imageCapture.blit) {
    imageCapture.blit.dispose();
    imageCapture.blit = null;
  }
  activeSession.latestCameraTexture = null;
}

/**
 * Acquire a camera-color lookup for the current XR frame (passed to the
 * DepthSampler as `acquireRgbLookup`; called at most once per emitted
 * sample). Returns null — color-less points — when camera access or the
 * readback is unavailable; the blit instance lazily (re)creates itself so
 * a disposal elsewhere is self-healing.
 */
function acquireDepthRgbLookup(): RgbLookup | null {
  const { latestCameraTexture, depth } = activeSession;
  const { renderer } = activeSession.sceneGraph;
  if (!renderer || !latestCameraTexture) {
    return null;
  }
  depth.rgbBlit ??= new CameraBlitCapture(DEPTH_RGB_BLIT_CONFIG);
  const readback = depth.rgbBlit.captureToPixels(renderer, latestCameraTexture);
  return readback
    ? createRgbLookup(readback.pixels, readback.width, readback.height)
    : null;
}

/**
 * Capture the current XR frame as top-left RGBA for CV detection (the
 * `capture` injected into {@link CameraFrameSource}; called at most once per
 * detection interval). Returns null — no frame this tick — when camera access
 * or the texture is unavailable; the lazy blit makes a disposal elsewhere
 * self-healing. Reuses `latestCameraTexture`, exactly like the depth-RGB path.
 */
function acquireCameraFrameRgba(): RgbaImage | null {
  const { latestCameraTexture, cameraFrame } = activeSession;
  const { renderer } = activeSession.sceneGraph;
  if (!renderer || !latestCameraTexture) {
    return null;
  }
  // Size the readback to the camera ASPECT with the longer edge =
  // cameraFrame.captureSize (Option 1) so a 4:3 frame becomes e.g. 512×384 — the
  // target reaches the detector undistorted instead of squashed into a square.
  // The camera dimensions are set alongside `latestCameraTexture` each frame;
  // `resizeIfNeeded` is a no-op once they stabilise, so the realloc only happens
  // on the first frame or a device rotation.
  const target = computeAspectFitSize(
    activeSession.latestCameraWidth,
    activeSession.latestCameraHeight,
    cameraFrame.captureSize
  );
  if (!cameraFrame.blit) {
    cameraFrame.blit = new CameraBlitCapture(target);
  } else {
    cameraFrame.blit.resizeIfNeeded(target.width, target.height);
  }
  return cameraFrame.blit.captureToRgba(renderer, latestCameraTexture);
}

/**
 * Get the current raw AR pose from the latest XR frame.
 * This is updated every frame and should be called when GPS arrives
 * to get the AR pose at that moment.
 *
 * IMPORTANT: This returns the RAW pose from WebXR, NOT transformed
 * by any alignment matrix. This is what we record to the store.
 *
 * @returns The latest AR pose, or null if no pose available yet
 */
export function getCurrentArPose(): ARPose | null {
  return activeSession.latestArPose;
}

/**
 * Opt-in standard WebXR session features that are independent of the
 * crash-isolation diagnostic flags. Kept separate from
 * `ArCrashIsolationOptions` because requesting `hit-test` is a normal app
 * capability, not a crash-isolation toggle.
 */
export interface SessionFeatureOptions {
  /**
   * Request the WebXR `hit-test` feature (as an *optional* feature) so app
   * code can drive a reticle via `registerXrFrameUpdate`. Default `false` —
   * existing recorder/anchor sessions are unaffected.
   */
  requestHitTest?: boolean;
  /**
   * Request `depth-sensing` (cpu-optimized) for the **live depth occluder**
   * even when crash-isolation's `enableDepthSensingFeature` is off. Consumer
   * apps (AnchorStarter / MinimalExample) want occlusion without the recorder's
   * depth-capture wiring, so the occluder owns its own session-feature switch.
   * Both flags resolve the **same** cpu-optimized usage — setting both is valid
   * (no conflict, no throw): the grid sampler and the occluder are two consumers
   * of one depth read. Default `false`.
   *
   * @see GpsPlusSlamJs_Docs/docs/2026-06-14-0009-webxr-depth-occlusion-plan.md §6/§8
   */
  requestDepthOcclusion?: boolean;
}

/**
 * Build XR session init options.
 * Extracted as a pure function for testability.
 *
 * Exported for unit testing only (surface-reduction step 3, B-5 precedent):
 * production code reaches this exclusively through {@link initAR}; the export
 * exists so `webxr-session.test.ts` can pin the full session-negotiation
 * matrix (isolation flags × session features) without mocking a renderer and
 * `navigator.xr` for every combination. Not re-exported by the ar/ barrel.
 *
 * @param rootElement - The DOM element for DOM overlay
 * @param isolationOptions - Crash-isolation diagnostic flags (DOM overlay,
 *   depth-sensing, camera-access)
 * @param sessionFeatures - Opt-in standard WebXR features that are independent
 *   of crash isolation (`requestHitTest`, `requestDepthOcclusion`)
 * @returns XRSessionInit options
 * @throws Error if rootElement is null
 */
export function buildSessionOptions(
  rootElement: Element | null,
  isolationOptions: Partial<ArCrashIsolationOptions> = {},
  sessionFeatures: SessionFeatureOptions = {}
): XRSessionInit {
  if (!rootElement) {
    throw new Error('App root element not found');
  }
  const normalizedOptions = validateArCrashIsolationOptions(isolationOptions);
  const optionalFeatures: string[] = [];
  const sessionOptions: XRSessionInit = {
    requiredFeatures: ['local-floor'],
  };

  if (normalizedOptions.enableDomOverlay) {
    optionalFeatures.push('dom-overlay');
    sessionOptions.domOverlay = { root: rootElement };
  }

  // Request depth-sensing if EITHER the recorder's depth-capture flag OR the
  // live occluder's `requestDepthOcclusion` is set. Both resolve the same
  // cpu-optimized stream, so they coexist — request the feature exactly once.
  if (
    normalizedOptions.enableDepthSensingFeature ||
    sessionFeatures.requestDepthOcclusion
  ) {
    optionalFeatures.push('depth-sensing');
    Object.assign(sessionOptions, {
      // `depthSensing` is REQUIRED whenever `depth-sensing` is requested,
      // otherwise Chrome/ARCore throws a TypeError.
      //
      // We deliberately pin `cpu-optimized` as the single source of truth: the
      // `XRCPUDepthInformation` it yields feeds BOTH the OccupancyGrid / COLMAP
      // export (via DepthSampler.getDepthInMeters) AND the live depth occluder
      // (which uploads the raw `data` buffer + `normDepthBufferFromNormView` /
      // `rawValueToMeters` metadata each frame). `gpu-optimized` would surrender
      // that CPU buffer and is therefore rejected — not (any longer) merely to
      // dodge the old three.js `getDepthInformation` null-deref (fixed in r184),
      // but because cpu-optimized is what every depth consumer here is built on.
      // See 2026-06-14-0009-webxr-depth-occlusion-plan.md §1.
      depthSensing: {
        usagePreference: ['cpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32'],
      },
    });
  }

  if (normalizedOptions.enableCameraAccess) {
    optionalFeatures.push('camera-access');
  }

  // Hit-test is requested as an *optional* feature (not required) so the
  // session still starts on devices/runtimes without hit-test support; the
  // app guards on whether a hit-test source is actually obtainable. Opt-in
  // via `requestHitTest` so existing recorder/anchor sessions are unaffected.
  if (sessionFeatures.requestHitTest) {
    optionalFeatures.push('hit-test');
  }

  if (optionalFeatures.length > 0) {
    sessionOptions.optionalFeatures = optionalFeatures;
  }

  return sessionOptions;
}

/**
 * Check if WebXR immersive-ar is supported.
 *
 * Delegates to the timeout-guarded {@link probeImmersiveArSupport} — a
 * wedged OS XR runtime can make the underlying `isSessionSupported`
 * promise never settle (2026-07-24), and this check must degrade to
 * `false` instead of hanging the caller's boot path.
 */
export async function isWebXRSupported(): Promise<boolean> {
  return probeImmersiveArSupport();
}

/**
 * Host callbacks for one AR session, passed to {@link initAR} as a single
 * struct (2026-07-11 surface-reduction step 1 — replaces the 13 pre-init
 * setter exports, which forced every consumer to know a call order and
 * allowed half-wired states like a tracking store without its callbacks).
 *
 * Everything here is INIT-TIME wiring: initAR unpacks the struct once into
 * the session handle's slots the frame path reads directly (one monomorphic
 * property access, no per-frame indirection), and `resetWebXRState()`
 * replaces the handle at session end — re-pass the struct with each
 * `initAR`. The single mid-session mutation the
 * apps need (the recorder swapping its Redux store per recording) has its own
 * narrow function, {@link rebindTrackingStore}.
 */
export interface ArSessionCallbacks {
  /**
   * Periodic JPEG image capture (recording). Presence wires the capture
   * slots; `startImageCapture()` is what begins capturing.
   */
  imageCapture?: {
    /** Called when an image is successfully captured. */
    onCaptured: (image: CapturedImage) => void;
    /** Returns current device screen rotation (0, 90, 180, 270). */
    getScreenRotation: () => number;
    /** Called when image capture fails (e.g. low memory). */
    onFailed?: () => void;
    /** Called when a captured image appears black/empty. */
    onSuspicious?: (blobSize: number, frameIndex: number) => void;
    /**
     * Off-thread blur/blackness analyzer for the drop+retry quality gate
     * (a Web Worker in the recorder — the host owns its lifecycle). Only
     * invoked when the capture config's `qualityFilter.enabled` is true.
     * Absent ⇒ the legacy save-immediately path.
     */
    qualityAnalyzer?: (frame: CapturedFrame) => Promise<FrameQualityVerdict>;
  };
  /**
   * Tracking-state pipeline. Store and callbacks arrive TOGETHER — the
   * half-wired store/callbacks split of the old two-setter API is
   * structurally impossible. Presence of this group activates per-frame
   * `poseReceived`/`poseLost` dispatches and the phase→callback translation.
   */
  tracking?: {
    /** The host store carrying the tracking slice. */
    store: TrackingSubscribableStore;
    /** Tracking restarted after loss with an origin reset (Case 2). */
    onRestarted?: (payload: OdometryTrackingRestartedPayload) => void;
    /** Tracking lost (pose became null). */
    onLost?: () => void;
    /** Tracking recovered seamlessly, same coordinate frame (Case 1). */
    onRecovered?: () => void;
  };
  /**
   * Depth sampling. Presence creates the DepthSampler at init;
   * `startDepthCapture()` is what begins sampling.
   */
  depth?: {
    /** Called for each captured depth sample. */
    onCaptured: (sample: DepthSample) => void;
    /** Called once if depth was requested but is unavailable. */
    onUnavailable?: () => void;
  };
  /**
   * Throttled camera RGBA frames for CV (QR detection today). Presence
   * creates the CameraFrameSource at init; `startCameraFrameCapture()` is
   * what begins delivering frames.
   */
  cameraFrame?: {
    /** Called with each throttled top-left-origin RGBA frame. */
    onFrame: (image: RgbaImage) => void;
  };
  /**
   * Per-frame callback, invoked every XR frame after pose updates but before
   * render (e.g. map overlay position updates).
   */
  onFrame?: () => void;
  /**
   * Fired exactly once whenever the XRSession ends — app-initiated
   * ({@link endARSession}) AND system-initiated (e.g. the Android back
   * gesture). `info.requestedByApp` discriminates the two. Fired AFTER the
   * full teardown, so the host can start a fresh session from inside it.
   */
  onSessionEnd?: (info: SessionEndInfo) => void;
}

/**
 * Initialize the AR session and Three.js renderer.
 * @param container - DOM element to host the AR canvas and CSS3D overlay.
 * @param isolationOptions - Crash-isolation diagnostic flags.
 * @param sessionFeatures - Opt-in standard WebXR features (e.g.
 *   `requestHitTest`) forwarded to the session negotiation.
 * @param callbacks - Host callbacks for this session (see
 *   {@link ArSessionCallbacks}); unpacked once into the session handle's
 *   slots, which `resetWebXRState()` replaces wholesale at session end.
 */
export async function initAR(
  container: HTMLElement,
  isolationOptions: Partial<ArCrashIsolationOptions> = {},
  sessionFeatures: SessionFeatureOptions = {},
  callbacks: ArSessionCallbacks = {}
): Promise<void> {
  if (!navigator.xr) {
    throw new Error('WebXR not available');
  }

  // Guard against re-entry. A renderer/session is only non-null between a
  // successful initAR() and a matching endARSession()/resetWebXRState(). If
  // either is still set, calling initAR() again would orphan the previous
  // renderer's canvas in the DOM and leak its GPU resources while silently
  // replacing the live handle. Surface this as a programming error so the
  // host tears down the existing session explicitly first.
  if (activeSession.sceneGraph.renderer || activeSession.xrSession) {
    throw new Error(
      'AR session already initialized — call endARSession() before initAR() again'
    );
  }

  // Fresh per-session handle carrying this session's validated crash-isolation
  // options, every callback slot (incl. the per-frame tick), and the
  // scene-graph/session fields populated below (Stages 0–3). No per-frame
  // indirection beyond one monomorphic property access: onXRFrame reads the
  // handle fields directly.
  activeSession = createArSessionHandle(
    validateArCrashIsolationOptions(isolationOptions),
    callbacks
  );
  const { sceneGraph } = activeSession;

  // G-7 (2026-07-10 quality review): apply the Chromium camera-access
  // tab-crash workaround here so every consumer gets it by default —
  // forgetting the manual bootstrap call meant a Chrome tab crash. Runs
  // before the renderer/session negotiation (three.js only probes the
  // deleted prototypes at session start) and is idempotent, so apps that
  // still call `applyChromiumProjectionLayerWorkaround()` at bootstrap are
  // unaffected. Opt out via `isolationOptions` on unaffected devices
  // (e.g. Quest) where forcing `XRWebGLLayer` could regress WebXR.
  if (activeSession.crashIsolation.applyChromiumProjectionLayerWorkaround) {
    applyChromiumProjectionLayerWorkaround();
  }

  // Create Three.js renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
  });
  sceneGraph.renderer = renderer;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  // Insert canvas into DOM
  container.insertBefore(renderer.domElement, container.firstChild);

  // Create CSS3D renderer overlay (Approach E) — child of dom overlay root
  // so it's visible in WebXR's dom-overlay compositing.
  if (activeSession.crashIsolation.enableCss3dRenderer) {
    sceneGraph.css3d = createCss3dRendererManager(
      container,
      window.innerWidth,
      window.innerHeight
    );
  }

  // Create scene with proper hierarchy. The arpose node stays in the graph
  // only (no handle ref) — see the NOTE next to the handle state above.
  const hierarchy = createSceneHierarchy();
  sceneGraph.scene = hierarchy.scene;
  sceneGraph.arWorldGroup = hierarchy.arWorldGroup;
  sceneGraph.camera = hierarchy.camera;

  // Request AR session with validated options
  const sessionOptions = buildSessionOptions(
    container,
    activeSession.crashIsolation,
    sessionFeatures
  );

  const xrSession = await navigator.xr.requestSession(
    'immersive-ar',
    sessionOptions
  );
  activeSession.xrSession = xrSession;

  // Handle session end — BOTH trigger paths funnel through this listener:
  // the system-initiated end (Android back gesture — fires 'end' directly)
  // and the app's own endARSession() (its session.end() fires the same
  // event). handleSessionEnded() runs the full teardown and notifies the
  // host exactly once (F3, 2026-07-04 user feedback).
  xrSession.addEventListener('end', () => {
    handleSessionEnded();
  });

  await renderer.xr.setSession(xrSession);

  // Initialize the tracking pipeline when the host supplied the `tracking`
  // callbacks group. The store and its callbacks arrive together in one
  // struct, so the old half-wired store/callbacks split (G-5, 2026-07-10
  // quality review) is structurally impossible now. Without the group we
  // keep the legacy no-op behaviour: `onXRFrame` never dispatches and no
  // callbacks ever fire. See docs/2026-05-13-tracking-state-slice-port-plan.md.
  const trackingStore = activeSession.tracking.store;
  if (trackingStore) {
    const store = trackingStore;
    // Start from a clean slate — the previous session may have left the
    // slice in any phase. The subscription created below starts with its
    // own closure-local `prev = 'initializing'`, so this dispatch makes
    // the slice match.
    store.dispatch(resetTrackingAction());

    activeSession.tracking.phaseUnsubscribe = subscribeToTrackingPhase(store);

    // Listen for XRReferenceSpace reset events to distinguish Case 1 (seamless
    // recovery) from Case 2 (relocalization). The reset event fires when the
    // runtime shifts the reference space origin after tracking loss recovery.
    const referenceSpace = renderer.xr.getReferenceSpace();
    if (referenceSpace) {
      referenceSpace.addEventListener('reset', (event: Event) => {
        // Extract the XRReferenceSpaceEvent.transform, distinguishing:
        //   - property missing (older browsers) → undefined
        //   - property null (runtime can't determine delta) → null
        //   - property present with data → ResetTransformData
        const transformData = extractResetTransformData(
          event as unknown as Record<string, unknown>
        );
        store.dispatch(originResetAction(transformData));
        log.warn(
          'XR reference space reset detected',
          transformData ? '(transform available)' : '(no transform)'
        );
      });
    }
  }

  // Initialize depth sampler if callback is set
  const onDepthSampleCaptured = activeSession.depth.onCaptured;
  if (onDepthSampleCaptured) {
    const depthCallbacks: DepthSamplerCallbacks = {
      onSampleCaptured: onDepthSampleCaptured,
      getCurrentPose: getCurrentArPose,
      // Iter 8: per-sample camera color for the occupancy-grid voxels.
      // Gated inside the sampler by its `rgb` config (recording option).
      acquireRgbLookup: acquireDepthRgbLookup,
      // Field Test Readiness Issue #8: Notify user if depth is unavailable
      onDepthUnavailable: activeSession.depth.onUnavailable ?? undefined,
    };
    activeSession.depth.sampler = new DepthSampler(depthCallbacks);
  }

  // Initialize the camera frame source if a frame callback is set (B2). The
  // source owns the detection-cadence throttle; the session owns the blit
  // (acquireCameraFrameRgba reuses `latestCameraTexture`), exactly like the
  // depth-RGB path. `startCameraFrameCapture` is what begins delivering frames.
  const deliverCameraFrame = activeSession.cameraFrame.onFrame;
  if (deliverCameraFrame) {
    activeSession.cameraFrame.source = new CameraFrameSource({
      capture: acquireCameraFrameRgba,
      onCapture: (image) => deliverCameraFrame(image),
    });
  }

  // Start render loop
  renderer.setAnimationLoop(onXRFrame);

  log.info('AR session started');
}

/**
 * Snapshot the current `DeviceOrientation` (with documented fallback
 * defaults) for inclusion in `poseReceived` payloads.
 */
function snapshotDeviceOrientation(): {
  alpha: number;
  beta: number;
  gamma: number;
  absolute: boolean;
} {
  const orientation = getLastDeviceOrientation();
  return {
    alpha: orientation?.alpha ?? 0,
    beta: orientation?.beta ?? 0,
    gamma: orientation?.gamma ?? 0,
    absolute: orientation?.absolute ?? false,
  };
}

/**
 * Wire the tracking-slice → host-callbacks translation. The subscriber
 * runs synchronously inside each `dispatch`, so the host callbacks fire
 * in the same order as a direct invocation would.
 *
 * Translation rules (locked in by tracking-slice tests; the host callbacks
 * live on `activeSession.tracking`):
 *   - `tracking → lost`: clear `latestArPose` (drops in-flight GPS events)
 *     and call the host's `onLost`.
 *   - `lost → tracking` with `lastRestartedPayload !== null` (Case 2):
 *     call the host's `onRestarted(payload)` then dispatch
 *     `clearLastRestartedPayload` so a subsequent loss cycle starts clean.
 *   - `lost → tracking` with payload null (Case 1: seamless recovery):
 *     call the host's `onRecovered`.
 *   - `initializing → tracking`: no callback (initial acquisition is not
 *     a restart — same behaviour as the manager).
 */
function subscribeToTrackingPhase(
  store: TrackingSubscribableStore
): () => void {
  // `prev` is closure-local so the mirror state is naturally scoped to a
  // single subscription. Disposing the subscription (or replacing the
  // store via `rebindTrackingStore`) discards this closure, so the next
  // subscription always starts fresh at 'initializing'.
  let prev: TrackingPhase = 'initializing';
  return store.subscribe(() => {
    const next = selectTrackingPhase(store.getState());
    if (next === prev) return;
    const previous = prev;
    prev = next;

    if (previous === 'tracking' && next === 'lost') {
      log.warn('Tracking lost');
      // Drop GPS events during tracking loss by nulling the pose.
      // The recording coordinator's null guard will skip GPS events.
      activeSession.latestArPose = null;
      activeSession.tracking.onLost?.();
      return;
    }

    if (previous === 'lost' && next === 'tracking') {
      const payload = selectLastRestartedPayload(store.getState());
      if (payload !== null) {
        log.info('Tracking restarted (origin reset)');
        activeSession.tracking.onRestarted?.(payload);
        store.dispatch(clearLastRestartedPayloadAction());
      } else {
        // A null payload means Case 1 (no origin reset during loss). The
        // legacy manager had a third branch — origin reset flagged but
        // `lastValidPose === null` → warn + fire nothing — but that state is
        // unreachable: `phase` only becomes 'lost' from 'tracking', and
        // 'tracking' is only entered via `poseReceived`, which always sets a
        // non-null `lastValidPose`. So LOST ⟹ lastValidPose !== null, and the
        // only remaining null-payload case is a genuine seamless recovery.
        // See tracking-slice.ts (defensive branch) and the port plan doc.
        log.info('Tracking recovered (same coordinate frame)');
        activeSession.tracking.onRecovered?.();
      }
    }
  });
}

/**
 * Dispatch the per-frame `poseReceived` / `poseLost` action into the
 * tracking slice. No-op when no store is bound (tracking wiring was not
 * requested via initAR `callbacks.tracking`).
 */
function updateTrackingState(arPose: ARPose | null): void {
  const { store } = activeSession.tracking;
  if (!store) {
    return;
  }

  if (arPose) {
    store.dispatch(
      poseReceivedAction({
        pose: arPose,
        sensorOrientation: snapshotDeviceOrientation(),
      })
    );
  } else {
    store.dispatch(poseLostAction());
  }
}

/**
 * Called each XR frame
 */
function onXRFrame(time: number, frame: XRFrame | undefined): void {
  const { renderer, scene, camera } = activeSession.sceneGraph;
  if (!renderer || !scene || !camera || !frame) {
    return;
  }

  const referenceSpace = renderer.xr.getReferenceSpace();
  if (!referenceSpace) {
    return;
  }

  const pose = frame.getViewerPose(referenceSpace);
  const arPose = extractPoseFromViewer(pose);

  // Update tracking state manager
  updateTrackingState(arPose);

  // Tick the per-frame callback registry. `dt`/`elapsed` are derived from
  // the XR `time` argument (monotonic ms since session start) — not from
  // `THREE.Clock` — so replay/test harnesses that drive `onXRFrame` with
  // synthetic timestamps see deterministic ticks. See `frame-loop.ts.md`
  // and `2026-05-13-ecs-migration-plan.md`.
  const dt =
    activeSession.lastFrameTime === 0
      ? 0
      : (time - activeSession.lastFrameTime) / 1000;
  const elapsed = time / 1000;
  activeSession.lastFrameTime = time;
  runFrameUpdates(dt, elapsed);

  // Hand the live XR context to app-registered per-frame callbacks (hit-test,
  // light estimation, …). `frame`/`referenceSpace`/`session` are valid only
  // synchronously inside each callback — see `xr-frame-loop.ts` safety
  // contract. We only run these when a session is live (it always is inside
  // `onXRFrame`, but the guard keeps the types honest and avoids firing during
  // teardown races).
  const { xrSession } = activeSession;
  if (xrSession) {
    runXrFrameUpdates({
      frame,
      referenceSpace,
      session: xrSession,
      dt,
      elapsed,
    });
  }

  if (arPose) {
    // Store the latest pose for getCurrentArPose()
    activeSession.latestArPose = arPose;
  }

  // Extract camera texture for blit capture (camera-access feature).
  // The texture is only valid within this XR frame callback, so we clear
  // any previous reference up-front and only repopulate on successful
  // acquisition this frame. This prevents stale textures from being used
  // in the subsequent capture logic (which could cause native crashes).
  activeSession.latestCameraTexture = null;
  if (activeSession.crashIsolation.enableCameraTextureAcquisition) {
    // getXrCameraFromPose() collapses every precondition failure
    // (pose=null, no views, no .camera, invalid dimensions) to a single
    // null result. Combined with the unconditional clear above, this
    // guarantees we never reuse a stale camera texture across frames.
    const xrCamera = getXrCameraFromPose(pose);

    // Diagnostic: log camera-access grant status once per session.
    // See shouldLogCameraAccessDiagnostic() for why `pose` is part of the
    // guard (prevents a false "NOT GRANTED" when the session's first frame
    // arrives with tracking lost).
    if (
      shouldLogCameraAccessDiagnostic(
        pose,
        activeSession.cameraAccessLoggedOnce,
        activeSession.imageCapture.manager !== null
      )
    ) {
      activeSession.cameraAccessLoggedOnce = true;
      if (xrCamera) {
        log.info(
          'camera-access GRANTED — XRView.camera is available for blit capture'
        );
      } else {
        log.warn(
          'camera-access NOT GRANTED — XRView.camera is undefined. ' +
            'Image capture will fall back to canvas.toBlob() which may produce black/empty frames in WebXR.'
        );
      }
    }

    if (xrCamera) {
      // Use Three.js's built-in getCameraTexture() API.
      // Internally, Three.js creates XRWebGLBinding, calls getCameraImage(),
      // and wraps the result in an ExternalTexture (proper texture subclass).
      const result = acquireCameraTexture(renderer, xrCamera);
      if (result) {
        activeSession.latestCameraTexture = result.texture;
        activeSession.latestCameraWidth = result.width;
        activeSession.latestCameraHeight = result.height;
      } else {
        // Diagnostic: log when getCameraTexture returns null/undefined
        activeSession.getCameraTextureNullCount++;
        if (
          activeSession.getCameraTextureNullCount <=
          GET_CAMERA_TEXTURE_LOG_THRESHOLD
        ) {
          log.warn(
            `getCameraTexture() returned null (occurrence ${activeSession.getCameraTextureNullCount}/${GET_CAMERA_TEXTURE_LOG_THRESHOLD}). ` +
              'camera-access is granted but Three.js did not provide a texture.'
          );
        }
      }
    }
  }

  // Check if we need to capture an image
  const { manager: imageManager } = activeSession.imageCapture;
  if (imageManager) {
    imageManager.onFrame(time);
  }

  // Check if we need to sample depth. The provider is lazy (quality-review
  // E-4): the sampler only invokes it when a sample is due, so the
  // getDepthInformation + wrap cost is paid ~1×/interval instead of every
  // render frame.
  const { sampler: depthSampler } = activeSession.depth;
  if (depthSampler) {
    depthSampler.onFrame(time, () => getDepthInfoFromFrame(frame, pose));
  }

  // Check if we need to capture a camera frame for CV. The source throttles to
  // the detection cadence, so the (more expensive, ~512²) blit runs ~8×/s — not
  // every render frame. Must run after `latestCameraTexture` is set above.
  const { source: cameraFrameSource } = activeSession.cameraFrame;
  if (cameraFrameSource) {
    cameraFrameSource.onFrame(time);
  }

  // Call per-frame callback (e.g., for map overlay position updates)
  const { onFrame } = activeSession;
  if (onFrame) {
    try {
      onFrame();
    } catch (error) {
      log.error('Error in onFrame callback:', error);
    }
  }

  renderer.render(scene, camera);

  // Render CSS3D overlay (DOM-based 3D objects like Leaflet map)
  const { css3d } = activeSession.sceneGraph;
  if (activeSession.crashIsolation.enableCss3dRenderer && css3d) {
    css3d.render(scene, camera);
  }
}

/**
 * Extract depth information from an XR frame. Returns `null` if depth sensing is
 * not available (no pose/view, no `getDepthInformation`, or the call throws).
 *
 * Exported so a consumer can feed the **live depth occluder** from a
 * `registerXrFrameUpdate` callback — the callback has the live `frame` +
 * `referenceSpace`, computes `pose = frame.getViewerPose(referenceSpace)`, and
 * passes both here to obtain the per-frame {@link DepthInfo} (with the widened
 * `data` / `rawValueToMeters` / `normDepthBufferFromNormView` / `projectionMatrix`
 * the occluder needs). The same wrapped depth the sparse grid sampler consumes.
 */
export function getDepthInfoFromFrame(
  frame: XRFrame,
  pose: XRViewerPose | null
): DepthInfo | null {
  const view = pose?.views[0];
  if (!view) {
    return null;
  }

  // XRFrame may have getDepthInformation method if depth-sensing feature is enabled
  // TypeScript doesn't have full types for this yet. The `data` /
  // `rawValueToMeters` / `normDepthBufferFromNormView` fields exist on
  // XRCPUDepthInformation and are forwarded to the live depth occluder via
  // wrapXRDepthInfo (the sparse grid sampler reads only getDepthInMeters).
  const xrFrame = frame as XRFrame & {
    getDepthInformation?: (view: XRView) => {
      width: number;
      height: number;
      getDepthInMeters: (x: number, y: number) => number;
      data?: ArrayBuffer;
      rawValueToMeters?: number;
      normDepthBufferFromNormView?: { matrix?: Float32Array } | null;
    } | null;
  };

  if (typeof xrFrame.getDepthInformation !== 'function') {
    return null;
  }

  try {
    const result = xrFrame.getDepthInformation(view);
    if (!result) {
      return null;
    }
    // Wrap instead of passing the raw browser object through: this binds
    // getDepthInMeters and attaches the capturing view's projection matrix,
    // which each DepthSample needs for later unprojection (occupancy grid).
    return wrapXRDepthInfo(result, view.projectionMatrix);
  } catch {
    // Depth sensing may fail on some devices
    return null;
  }
}

// ---------------------------------------------------------------------------
// Live-session scene getters
//
// These return the LIVE AR session's scene graph (set internally by initAR,
// cleared by resetWebXRState) and are null at any other time — including
// during desktop replay. The historical replay-mode "Risk R1" injection
// exports (setScene/setArWorldGroup/setCamera/setArPose/getArPose — see
// docs/2026-02-19-replay-mode.md, now superseded on this point) were deleted
// by the 2026-07-11 webxr-session surface-reduction plan, step 2: replay owns
// its scene in replay-scene.ts and exposes it via getReplayState(); replay
// consumers read those references instead of this module.
// ---------------------------------------------------------------------------

/**
 * Get the current Three.js scene (for adding objects like map)
 */
export function getScene(): THREE.Scene | null {
  return activeSession.sceneGraph.scene;
}

/**
 * Get the AR world group (for adding AR-tracked content)
 * Content added here will be transformed by the alignment matrix.
 */
export function getArWorldGroup(): THREE.Group | null {
  return activeSession.sceneGraph.arWorldGroup;
}

/**
 * Get the current camera
 */
export function getCamera(): THREE.PerspectiveCamera | null {
  return activeSession.sceneGraph.camera;
}

/**
 * Apply an alignment matrix to the AR world group.
 *
 * The alignment matrix maps odometry positions in NUE space
 * to GPS world space (also NUE). It is applied directly to arWorldGroup
 * whose local space is NUE.
 *
 * The WebXR→NUE basis change lives permanently in basisChangeNode (a
 * child of arWorldGroup), so the full camera world transform is:
 *
 *   camera_world = arWorldGroup × basisChangeNode × arpose × camera_local
 *               = alignment × WEBXR_TO_NUE × arpose × camera_local
 *
 * This is mathematically identical to the previous composition
 * (alignment × WEBXR_TO_NUE applied directly to arWorldGroup.matrix),
 * but arWorldGroup's local space is now NUE: objects placed as children
 * of arWorldGroup use NUE coordinates directly ([1,0,0]=North, [0,0,1]=East).
 *
 * Replay note: arpose still lives in WebXR space (below basisChangeNode),
 * so nuePositionToWebXR() is still required when setting arpose.position.
 *
 * @param matrix - 16-element column-major matrix (gl-matrix mat4 format)
 */
export function applyAlignmentMatrix(matrix: readonly number[]): void {
  const { arWorldGroup } = activeSession.sceneGraph;
  if (!arWorldGroup) {
    log.warn('Cannot apply alignment - arWorldGroup not initialized');
    return;
  }

  if (matrix.length !== 16) {
    log.error('Invalid alignment matrix - expected 16 elements');
    return;
  }

  // Write alignment directly — WEBXR_TO_NUE lives in basisChangeNode
  arWorldGroup.matrix.fromArray(matrix);
  arWorldGroup.matrixAutoUpdate = false;
  arWorldGroup.updateMatrixWorld(true);
}

/**
 * Convert a position from internal NUE convention (X=North, Y=Up, Z=East)
 * to WebXR local-floor convention (X=East, Y=Up, Z=South).
 *
 * Delegates to the canonical library implementation (nueToWebXR).
 * Accepts `readonly number[]` for call-site convenience.
 *
 * NUE [n, u, e] → WebXR [e, u, -n]
 */
export function nuePositionToWebXR(
  nue: readonly number[]
): readonly [number, number, number] {
  return _nueToWebXR(nue as [number, number, number]);
}

/**
 * Convert a quaternion from internal NUE convention to WebXR local-floor convention.
 *
 * Delegates to the canonical library implementation (nueQuaternionToWebXR).
 * Accepts `readonly number[]` for call-site convenience.
 *
 * NUE [x, y, z, w] → WebXR [z, y, -x, w]
 */
export function nueQuaternionToWebXR(
  nue: readonly number[]
): readonly [number, number, number, number] {
  return _nueQuaternionToWebXR(nue as [number, number, number, number]);
}

/**
 * The ONE teardown for a session that has ended, shared by both trigger
 * paths via the XRSession 'end' listener. Before F3 the system-initiated
 * path (back gesture) only nulled `xrSession`/`latestArPose`, leaving the
 * renderer compositing the 3D scene over a black camera background and the
 * host app never notified — the "haunted scene" from
 * docs/2026-02-15-lifecycle-orphans.md §1.
 */
function handleSessionEnded(): void {
  log.info('Session ended');
  // Capture callback + discriminator BEFORE teardown — resetWebXRState()
  // replaces the session handle, clearing both.
  const callback = activeSession.onSessionEnd;
  const requestedByApp = activeSession.endRequestedByApp;
  // Reset the tracking slice so the next session starts from a clean
  // INITIALIZING state (must run before resetWebXRState() replaces the
  // handle carrying the store).
  activeSession.tracking.store?.dispatch(resetTrackingAction());
  resetWebXRState();
  // Notify the host last, defensively: a throwing callback must never leave
  // the module half-torn-down.
  if (callback) {
    try {
      callback({ requestedByApp });
    } catch (err) {
      log.error('Session-end callback threw:', err);
    }
  }
}

/**
 * End the current XR session and clean up all resources.
 *
 * Stops the animation loop, ends the XR session, then delegates the full
 * teardown to {@link resetWebXRState} so every session reference is
 * cleared (renderer/scene/camera, image-capture, depth, the tracking-phase
 * subscription, the frame-update registry, diagnostics, blit resources).
 * This is the production cleanup path — call it when the AR experience is
 * finished.
 */
export async function endARSession(): Promise<void> {
  // Stop the render loop first so onXRFrame stops firing before we end the
  // session and tear everything down.
  activeSession.sceneGraph.renderer?.setAnimationLoop(null);

  // End the actual XR session and await it. resetWebXRState() in the
  // `finally` below only nulls the `xrSession` reference — it never calls
  // XRSession.end() — so ending the session here is the one piece of
  // teardown that is unique to the production path.
  //
  // The end()/teardown pair is wrapped in try/finally because
  // XRSession.end() can reject (e.g. the session is already ended or in an
  // invalid state). Without the `finally`, a rejection would skip the
  // teardown and leave `renderer`/`xrSession` non-null — and the re-entry
  // guard in initAR() would then permanently reject every subsequent
  // session until a page reload. Running the teardown unconditionally
  // guarantees the module always returns to a clean, re-initialisable state.
  try {
    const { xrSession } = activeSession;
    if (xrSession) {
      // Mark this end as app-initiated for the shared 'end' listener —
      // end() fires the same 'end' event a system-initiated end does, and
      // handleSessionEnded() consumes this flag to discriminate the paths.
      activeSession.endRequestedByApp = true;
      await xrSession.end();
    }
  } finally {
    // Delegate the rest of the teardown to resetWebXRState() so we never leak
    // any session reference. Re-implementing a subset here (the previous
    // approach) silently dropped imageCaptureManager, depthSampler, the
    // tracking-phase subscription, the frame-update registry, the scene-graph
    // references and the diagnostic counters — all of which resetWebXRState()
    // clears via the wholesale handle replacement. Keeping a single source of
    // truth for cleanup prevents new session state from leaking between
    // sessions when it is added to the handle but this path is forgotten.
    resetWebXRState();
  }
}

/**
 * Start capturing images during recording.
 * Requires the `imageCapture` callbacks group to have been passed to initAR.
 *
 * @param config - Optional capture configuration. Accepts the whole user
 *   image-options section (`intervalMs`, `quality`, `resolutionDivisor`; any
 *   extra keys such as `enabled` are ignored). Passing the section as one
 *   object means a newly-added option flows through without editing this seam
 *   — see `2026-06-12-1130-payload-rebuild-field-drop-audit.md` (F3).
 */
export function startImageCapture(config?: Partial<ImageCaptureConfig>): void {
  const { renderer } = activeSession.sceneGraph;
  if (!renderer) {
    log.warn('Cannot start image capture - renderer not initialized');
    return;
  }

  const { imageCapture } = activeSession;
  const onCaptured = imageCapture.onCaptured;
  const getRotation = imageCapture.getScreenRotation;
  if (!onCaptured || !getRotation) {
    log.warn('Cannot start image capture - callbacks not set');
    return;
  }

  // Stop any in-flight capture session before starting a new one. Without
  // this, a second startImageCapture() (e.g. toggling capture settings
  // mid-session) would overwrite the blit pipeline — leaking the previous
  // CameraBlitCapture and its WebGLRenderTarget GPU memory — and orphan the
  // previous ImageCaptureManager, leaving two managers competing over the
  // same callbacks and a dangling safety timeout running.
  if (imageCapture.manager || imageCapture.blit) {
    log.warn('Image capture already running - stopping previous session');
    stopImageCapture();
  }

  const callbacks: ImageCaptureCallbacks = {
    getCurrentPose: getCurrentArPose,
    getScreenRotation: getRotation,
    onCaptured: onCaptured,
    onCaptureFailed: imageCapture.onFailed ?? undefined,
    onSuspiciousImage: imageCapture.onSuspicious ?? undefined,
    // Off-thread blur/blackness gate (no-op unless qualityFilter.enabled). The
    // manager calls this after a motion-calm frame is encoded.
    analyzeFrame: imageCapture.qualityAnalyzer ?? undefined,
  };

  // Merge provided config with defaults up front so the blit pipeline and
  // the capture manager read from the same resolved configuration.
  const mergedConfig: ImageCaptureConfig = {
    ...DEFAULT_CAPTURE_CONFIG,
    ...config,
  };

  // Set up blit capture for WebXR opaque camera textures.
  // This creates a GPU pipeline that converts the opaque texture to readable pixels.
  // Falls back to canvas.toBlob() when camera-access is not available or blit fails.
  imageCapture.blit = new CameraBlitCapture();
  const currentRenderer = renderer;
  const divisor = mergedConfig.resolutionDivisor;
  callbacks.captureFrame = async (
    quality: number
  ): Promise<CapturedFrame | null> => {
    // Snapshot the session's blit into a local: ending/resetting the AR
    // session (resetWebXRState → cleanupBlitResources) can null/replace it
    // WHILE the captureToBlob() await below is in flight, and the post-await
    // getWidth()/getHeight() reads would then throw "Cannot read properties
    // of null". The local keeps a stable handle for this in-flight capture; a
    // frame from a torn-down session is harmlessly discarded downstream.
    const bc = activeSession.imageCapture.blit;
    const { latestCameraTexture, latestCameraWidth, latestCameraHeight } =
      activeSession;
    if (!bc || !latestCameraTexture) {
      // camera-access not available or no texture yet — fall back to
      // canvas.toBlob. The canvas backing store is what toBlob encodes, so its
      // width/height are the produced JPEG's true pixel dimensions.
      const canvas = currentRenderer.domElement;
      return new Promise<CapturedFrame | null>((resolve) => {
        canvas.toBlob(
          (blob) =>
            resolve(
              blob ? { blob, width: canvas.width, height: canvas.height } : null
            ),
          'image/jpeg',
          quality
        );
      });
    }

    // Dynamically resize render target to match camera resolution (divided by user scale)
    if (latestCameraWidth > 0 && latestCameraHeight > 0) {
      const target = computeCaptureSize(
        latestCameraWidth,
        latestCameraHeight,
        divisor
      );
      bc.resizeIfNeeded(target.width, target.height);
    }

    const blob = await bc.captureToBlob(
      currentRenderer,
      latestCameraTexture,
      quality
    );
    if (!blob) return null;
    // Render-target size == encoded JPEG size, so persist it as the image's
    // true pixel dimensions for aspect-correct frame-tile rendering.
    return {
      blob,
      width: bc.getWidth(),
      height: bc.getHeight(),
    };
  };
  log.info(`Blit capture pipeline initialized (resolutionDivisor=${divisor})`);

  imageCapture.manager = new ImageCaptureManager(
    renderer.domElement,
    callbacks,
    mergedConfig
  );
  imageCapture.manager.start();
  log.info('Image capture started');
}

/**
 * Stop capturing images.
 */
export function stopImageCapture(): void {
  const { imageCapture } = activeSession;
  if (imageCapture.manager) {
    imageCapture.manager.stop();
    log.info(
      `Image capture stopped (${imageCapture.manager.getFrameCount()} frames captured)`
    );
    imageCapture.manager = null;
  }
  cleanupBlitResources();
}

/**
 * Get the current image capture frame count.
 */
export function getImageCaptureFrameCount(): number {
  return activeSession.imageCapture.manager?.getFrameCount() ?? 0;
}

/**
 * Re-point the tracking pipeline at a NEW store mid-session.
 *
 * This is the ONE mutation that deliberately survived the fold of the
 * pre-init setters into initAR's `callbacks` (surface-reduction step 1):
 * it is a genuine RUNTIME need, not init-time wiring — the recorder swaps
 * its Redux store for every recording started inside a single AR session,
 * and without re-pointing, every per-frame `poseReceived` dispatch would
 * keep flowing into the orphaned previous store, pinning the new store's
 * `tracking.phase` at 'initializing' (Finding #1, 2026-05-23 user
 * feedback). Everything else about a session's callbacks stays fixed from
 * `initAR` until `resetWebXRState()`.
 *
 * Matches the old `setTrackingStore` semantics exactly: an active phase
 * subscription to the previous store is torn down before swapping (the
 * phase subscription itself is only (re)established inside `initAR`).
 * No-op pipeline when tracking was not wired at init (the host callbacks
 * stay whatever `initAR` set).
 *
 * @param store — any store satisfying {@link TrackingSubscribableStore}.
 */
export function rebindTrackingStore(store: TrackingSubscribableStore): void {
  // If we already have an active phase subscription to a different store,
  // tear it down before swapping. The new subscription is established
  // inside `initAR`, not here, because we also want it to survive
  // `resetWebXRState`-then-`initAR` cycles cleanly.
  const { tracking } = activeSession;
  if (tracking.phaseUnsubscribe) {
    tracking.phaseUnsubscribe();
    tracking.phaseUnsubscribe = null;
  }
  tracking.store = store;
}

/**
 * Start depth sampling during recording.
 * Requires the `depth` callbacks group to have been passed to initAR
 * (the sampler is created there).
 *
 * @param config - optional sampler overrides (typically the user's
 *   `depth.intervalMs`/`depth.gridSize` recording options); applied via
 *   `DepthSampler.updateConfig` before sampling starts. Without this the
 *   sampler's own defaults apply — the settings knobs were dead before
 *   this parameter existed (occupancy-grid port plan, Iter 6).
 */
export function startDepthCapture(config?: Partial<DepthSamplerConfig>): void {
  const { sampler } = activeSession.depth;
  if (!sampler) {
    log.warn('Cannot start depth capture - sampler not initialized');
    return;
  }
  if (config) {
    sampler.updateConfig(config);
  }
  sampler.start();
  log.info(
    `Depth capture started (interval: ${sampler.getConfig().intervalMs}ms, grid: ${sampler.getConfig().gridSize}×${sampler.getConfig().gridSize})`
  );
}

/**
 * Stop depth sampling.
 */
export function stopDepthCapture(): void {
  const { sampler } = activeSession.depth;
  if (sampler) {
    const count = sampler.getSampleCount();
    sampler.stop();
    log.info(`Depth capture stopped (${count} samples captured)`);
  }
}

/**
 * Get the current depth sample count.
 */
export function getDepthSampleCount(): number {
  return activeSession.depth.sampler?.getSampleCount() ?? 0;
}

/** Optional tuning for {@link startCameraFrameCapture}. */
export interface CameraFrameCaptureConfig {
  /** Detection cadence (ms between captures). Default 125 (~8 Hz). */
  intervalMs?: number;
  /**
   * Longer-edge resolution (px) of the camera-frame blit. Default
   * {@link DEFAULT_CAMERA_FRAME_CAPTURE_SIZE} (1024). The blit preserves the
   * camera ASPECT with its longer edge at this value (e.g. 1024 → 1024×768 for a
   * 4:3 camera), so the target reaches the detector undistorted. A QR needs ~3–5
   * px per module; the on-device sweep settled on 1024 (512 made small QRs decode
   * only at very close range). Applied before the first capture.
   */
  captureSize?: number;
}

/**
 * Start camera frame capture during an AR session. Requires the
 * `cameraFrame` callbacks group to have been passed to initAR (the source is
 * created there); the callback receives **top-left-origin** RGBA images (no
 * JPEG round-trip) at the throttled detection cadence — feed them straight to
 * a `BarcodeDetector` / OpenCV front-end (B2). No-op if the source was not
 * initialized (group not passed to initAR).
 *
 * The source is the single cadence owner: drive your detection scheduler from
 * the delivered frames with its own `minIntervalMs: 0` (Option A).
 *
 * @param config - optional cadence / blit-resolution overrides.
 */
export function startCameraFrameCapture(
  config?: CameraFrameCaptureConfig
): void {
  const { cameraFrame } = activeSession;
  if (!cameraFrame.source) {
    log.warn(
      'Cannot start camera frame capture - frame source not initialized'
    );
    return;
  }
  if (
    typeof config?.captureSize === 'number' &&
    Number.isFinite(config.captureSize) &&
    config.captureSize > 0
  ) {
    // Applied before the first capture allocates the blit.
    cameraFrame.captureSize = Math.floor(config.captureSize);
  }
  if (config?.intervalMs !== undefined) {
    cameraFrame.source.updateConfig({ intervalMs: config.intervalMs });
  }
  cameraFrame.source.start();
  log.info(
    `Camera frame capture started (interval: ${cameraFrame.source.getConfig().intervalMs}ms, long edge ${cameraFrame.captureSize}px, aspect-preserved)`
  );
}

/**
 * Stop camera frame capture. Safe to call when not running.
 */
export function stopCameraFrameCapture(): void {
  const { source } = activeSession.cameraFrame;
  if (source) {
    const count = source.getFrameCount();
    source.stop();
    log.info(`Camera frame capture stopped (${count} frames captured)`);
  }
}

/**
 * Get the number of camera frames captured since the last
 * `startCameraFrameCapture`.
 */
export function getCameraFrameCount(): number {
  return activeSession.cameraFrame.source?.getFrameCount() ?? 0;
}
