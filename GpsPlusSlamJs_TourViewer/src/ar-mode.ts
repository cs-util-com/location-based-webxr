/**
 * The M2 AR foundation of the QR-pose loop: pure view mapping for the AR
 * entry button, the `enable()` configuration both modes share, and the
 * on-running runtime start (session → alignment → camera capture). Plan:
 * gps-plus-slam `GpsPlusSlamJs_Docs/docs/2026-08-25-1227-qr-pose-tour-`
 * `relocalization-plan.md` §3 M2.
 *
 * Both modes are deliberately IDENTICAL down here (QD-5/delta #7): QR
 * detection needs camera frames everywhere, so camera access + texture
 * acquisition are ON in viewer AND author mode (v1 authoring takes the
 * printed size as an input, which dissolved the per-mode depth split, so
 * the QR pipelines never need depth). Author mode only changes labels here;
 * the pipelines diverge in M3/M4. Depth is asked for by the hooks alone
 * (`onDepthSample`): every CREATOR entry has them by default - the mesh
 * cursor's depth at the mesh density (polish round M5, a creator default
 * since 2026-10-15; `?mesh=0` drops it) - and an entry the troubleshooting
 * recording records (a creator's, or a visitor's with `?debug=1`) asks at
 * the recording's 16 x 16 / 1 Hz instead, because the recording carries
 * depth samples in place of camera pictures (authoring recording plan
 * 2026-09-28-0953, decision D4). Any other visitor entry asks for none.
 */

import type {
  ArSessionCallbacks,
  EnableGpsArConfig,
  EnableGpsArState,
  CapturedCameraFrame,
  TrackingSubscribableStore,
} from "gps-plus-slam-app-framework/ar";
import type {
  GpsPosition,
  RawDeviceOrientation,
} from "gps-plus-slam-app-framework/sensors";
import {
  startSession,
  teardownArSessionState,
  type DepthSample,
  type SubscribableStore,
} from "gps-plus-slam-app-framework/state";
import type {
  endSession,
  resetGpsSessionData,
} from "gps-plus-slam-app-framework/state";
import { DEFAULT_QR_CAPTURE_INTERVAL_MS } from "gps-plus-slam-app-framework/ar/qr/qr-capture-cadence";
import type { Object3D } from "three";

import type { ViewerMode } from "./mode.js";

/**
 * Camera-frame cadence (~8 Hz, the detection cadence the QR plan budgets
 * for). The frame source is the SINGLE cadence owner (Option A): the QR
 * controller that will consume these frames in M3/M4 must run
 * `minIntervalMs: 0`, because two equal throttles in series drop ~1 frame
 * per cycle. The value is the framework's shared QR default (DEC-H3), not
 * a copy.
 */
export const CAMERA_FRAME_INTERVAL_MS = DEFAULT_QR_CAPTURE_INTERVAL_MS;

export interface ArButtonView {
  label: string;
  disabled: boolean;
}

/** The mode-independent states (the mode only relabels ready/running). */
const STATIC_BUTTON_VIEWS: Record<
  "checking" | "unsupported" | "starting" | "stopping",
  ArButtonView
> = {
  checking: { label: "Checking AR support…", disabled: true },
  unsupported: { label: "AR not supported on this device", disabled: true },
  starting: { label: "Starting…", disabled: true },
  stopping: { label: "Stopping…", disabled: true },
};

/** The visitor's Copy link button on a phone without AR (async-UI rule:
 *  busy while the clipboard answers, then the outcome). */
export const COPY_LINK_LABELS = {
  idle: "Copy link",
  busy: "Copying…",
  done: "Link copied",
  failed: "Could not copy the link. Copy it from the address bar instead.",
} as const;

/** The way out of AR (UI round 1, U2, review F2). A visitor's is "Exit
 *  AR". A creator's is the ONE button of the session (polish round M3,
 *  Q-Done, B6): "Done" finishes when a finish can run, else leaves
 *  (`ar-entry.ts`; the draft keeps every change either way); "Saving…"
 *  while the zip is written, still tappable to leave; "Close AR" after a failed finish, so a finish
 *  that keeps failing cannot trap the creator (the panel's Finish is the
 *  retry). */
function runningButtonView(
  mode: ViewerMode,
  finish: { running: boolean; failed: boolean },
): ArButtonView {
  if (mode !== "creator") return { label: "Exit AR", disabled: false };
  // Tappable while saving (M3 review #1): reading a hosted zip can take
  // minutes on mobile data; a tap leaves AR and the finish carries on.
  if (finish.running) return { label: "Saving…", disabled: false };
  return { label: finish.failed ? "Close AR" : "Done", disabled: false };
}

/** The ready button: a creator starts; a visitor first allows the
 *  location (DEC-N2), shown busy while the browser asks. */
function readyButtonView(
  mode: ViewerMode,
  location: { pending: boolean; busy: boolean },
): ArButtonView {
  if (mode === "creator") return { label: "Start creating", disabled: false };
  if (location.busy) {
    return { label: "Getting your location…", disabled: true };
  }
  return {
    label: location.pending ? "Allow location" : "Start the tour",
    disabled: false,
  };
}

/** Pure state → button mapping (MinimalExample's `buttonView` pattern).
 *  `location` is the visitor screen's gate (DEC-N2): while pending, a ready
 *  button asks for the location first; while busy, it says so and is
 *  disabled (async-UI rule, M2 review #4). */
export function arButtonView(
  state: EnableGpsArState,
  mode: ViewerMode,
  location: { pending: boolean; busy: boolean } = {
    pending: false,
    busy: false,
  },
  /** A creator's finish: running (the zip is being written) or failed. */
  finish: { running: boolean; failed: boolean } = {
    running: false,
    failed: false,
  },
): ArButtonView {
  switch (state.status) {
    case "unsupported":
      // A visitor's way on: this page's link, for a phone that has AR
      // (polish round M4a, the owner's V4); ar-entry.ts does the copy.
      return mode === "visitor"
        ? { label: COPY_LINK_LABELS.idle, disabled: false }
        : STATIC_BUTTON_VIEWS.unsupported;
    case "ready":
      return readyButtonView(mode, location);
    case "running":
      return runningButtonView(mode, finish);
    case "error":
      return {
        // The reason is the status line's, in plain words (UI round 1,
        // U1, review F5); the raw error only under ?debug=1 there.
        label: "Try again",
        disabled: false,
      };
    default:
      return STATIC_BUTTON_VIEWS[state.status];
  }
}

/** The step a visitor's button is on (polish round M4a, the owner's V4):
 *  "1 of 2" while its tap only asks for the location (DEC-N2), "2 of 2"
 *  for the start after that was asked in this visit, and null otherwise -
 *  a visitor whose location was already allowed has one tap, not two. */
export function visitorStep(
  mode: ViewerMode,
  state: EnableGpsArState,
  location: { pending: boolean; busy: boolean },
  hadLocationStep: boolean,
): string | null {
  if (mode !== "visitor" || state.status !== "ready") return null;
  if (location.pending) return "1 of 2";
  return hadLocationStep ? "2 of 2" : null;
}

/** The app-side hooks the enable configuration forwards into. */
export interface ArEnableHooks {
  container: HTMLElement;
  /** Request the WebXR `hit-test` feature (the creator's reticle; a
   *  visitor places nothing). Without it the reticle never shows (plan
   *  review #4). */
  requestHitTest: boolean;
  /** The store `initAR` dispatches `tracking/poseReceived` into - the
   *  tracking-quality phase the placement trigger reads is derived from
   *  those dispatches (flows plan M4). Without it the slice is mounted but
   *  never fed, and the phase sits at `initializing` for the whole session. */
  trackingStore: TrackingSubscribableStore;
  /** Every throttled camera frame: top-left RGBA plus its capture pose/time. */
  onFrame(frame: CapturedCameraFrame): void;
  onSessionEnd(): void;
  onGpsPosition(position: GpsPosition): void;
  onOrientation(orientation: RawDeviceOrientation): void;
  /** Present for an entry that wants depth - a creator's by default (the
   *  mesh cursor, unless `?mesh=0`) and a recorded one in either mode
   *  (decision D4): requests the depth feature and receives its samples.
   *  Absent (an unrecorded visitor, a creator with `?mesh=0` and no
   *  recording), depth stays off. */
  onDepthSample?: (sample: DepthSample) => void;
  /** WebXR reset its origin after a tracking loss: raw-WebXR geometry
   *  (the mesh cursor's grid) is in a frame that no longer exists
   *  (follow-up F11). Only told; the restart is not dispatched to the
   *  solver (the 2026-10-02 follow-up's decision). */
  onTrackingRestarted?: () => void;
  /** `"none"`: the framework's codes-only mode - no location permission,
   *  no GPS watch (QR-first M1b-1, a visitor who declined location).
   *  Absent: the framework's default, location required. */
  location?: "none";
}

/**
 * The one `enable()` configuration both modes share. The camera-frame
 * callback MUST ride in here: `initAR` constructs the frame source from
 * `callbacks.cameraFrame` at session start, and `startCameraFrameCapture`
 * warns-and-no-ops when it was absent — it cannot be added later.
 */
export function buildArEnableConfig(hooks: ArEnableHooks): EnableGpsArConfig {
  const callbacks: ArSessionCallbacks = {
    cameraFrame: {
      onFrame: (frame) => {
        hooks.onFrame(frame);
      },
    },
    // The framework's own poseReceived/poseLost dispatch path (the recorder
    // learned on 2026-05-23 that a store not handed in here never leaves
    // `initializing`; the viewer re-learned it in the flows plan review).
    tracking: {
      store: hooks.trackingStore,
      ...(hooks.onTrackingRestarted === undefined
        ? {}
        : {
            onRestarted: () => {
              hooks.onTrackingRestarted?.();
            },
          }),
    },
    onSessionEnd: () => {
      hooks.onSessionEnd();
    },
    // Presence creates the framework's depth sampler at initAR; sampling
    // itself starts with `startDepthCapture` once the session runs.
    ...(hooks.onDepthSample === undefined
      ? {}
      : { depth: { onCaptured: hooks.onDepthSample } }),
  };
  return {
    container: hooks.container,
    requestHitTest: hooks.requestHitTest,
    ...(hooks.location === undefined ? {} : { location: hooks.location }),
    // Camera ON (access + texture acquisition) in BOTH modes; depth only
    // with `onDepthSample` (a creator's mesh cursor by default, or a
    // recorded entry), and then as an OPTIONAL feature: a phone without it
    // starts AR all the same, without depth.
    // These are the opposite of MinimalExample/AnchorStarter, which turn the
    // camera path off to dodge its Chromium crash surface; a CV app needs it
    // and inherits that surface (mitigated by the framework's projection-
    // layer workaround inside initAR).
    isolationOptions: {
      enableCameraAccess: true,
      enableDepthSensingFeature: hooks.onDepthSample !== undefined,
      enableCameraTextureAcquisition: true,
    },
    callbacks,
    onGpsPosition: (position) => {
      hooks.onGpsPosition(position);
    },
    onOrientation: (orientation) => {
      hooks.onOrientation(orientation);
    },
  };
}

/** Device functions the runtime start needs — seam-injected for tests/e2e. */
export interface TourArRuntimeDeps {
  getArWorldGroup(): Object3D | null;
  enableArWorldGroupAlignment(options: {
    store: SubscribableStore;
    arWorldGroup: Object3D;
  }): unknown;
  startCameraFrameCapture(config?: { intervalMs?: number }): void;
  now(): number;
}

export type TourArRuntimeResult = { ok: true } | { ok: false; error: string };

/**
 * The store surface the runtime start/end needs — STRUCTURAL on purpose:
 * `SlamAppStore` is generic over its extra reducers (this app adds the
 * `qrDetected` slice), and the framework's own guidance for consumers with
 * extra slices is to pass the store structurally (see
 * `combined-root-state.ts`; MinimalExample documents the same widening).
 */
export type TourArRuntimeStore = SubscribableStore & {
  dispatch(
    action:
      | ReturnType<typeof startSession>
      | ReturnType<typeof endSession>
      | ReturnType<typeof resetGpsSessionData>,
  ): unknown;
};

/**
 * The on-running sequence, in one place so it cannot be half-done:
 * 1. `startSession` — WITHOUT this the gps-event-coordinator silently drops
 *    every GPS fix (`isRecording` gate, no log), alignment never computes,
 *    and nothing anywhere says why (the framework's documented trap).
 * 2. `enableArWorldGroupAlignment` — binds the store's alignment matrix to
 *    the world group (self-registers for session teardown).
 * 3. `startCameraFrameCapture` — begins the ~8 Hz RGBA feed.
 * A missing world group fails loud and starts NOTHING (no session, no
 * capture), so the caller can surface one coherent error.
 */
export function startTourArRuntime(
  store: TourArRuntimeStore,
  deps: TourArRuntimeDeps,
): TourArRuntimeResult {
  const arWorldGroup = deps.getArWorldGroup();
  if (arWorldGroup === null) {
    return {
      ok: false,
      error: "AR started but no world group exists — cannot align content.",
    };
  }
  store.dispatch(
    startSession({
      contextTag: "tour-viewer",
      sessionName: "live",
      startTime: deps.now(),
    }),
  );
  deps.enableArWorldGroupAlignment({ store, arWorldGroup });
  deps.startCameraFrameCapture({ intervalMs: CAMERA_FRAME_INTERVAL_MS });
  return { ok: true };
}

/**
 * The teardown counterpart of {@link startTourArRuntime} — this AR entry is
 * explicitly RE-ENTERABLE (the controller returns to `ready` on session
 * end), and re-entering without this used to mix two odometry frames: the
 * first session's GPS elements stayed in the store, anchored to the DEAD
 * session's odom origin, while WebXR handed the new session a fresh one —
 * so the alignment solve blended both (PR #359 review). `endSession` closes
 * the recording; `resetCoordinatorState` clears the coordinator's cached
 * device-orientation state; `resetGpsSessionData` (core 1.20, closing the
 * M3 review #2 limit) drops the session's odometry↔GPS pairs and solved
 * alignment while PRESERVING the zero reference — WebXR hands the next
 * session a fresh odometry origin, so stale pairs would blend two frames
 * into one solve. The QR window is cleared by the caller
 * (`clearAllQrMarkers`).
 */
export function endTourArRuntime(
  store: TourArRuntimeStore,
  deps: { stopCameraFrameCapture(): void },
): void {
  deps.stopCameraFrameCapture();
  // The store half is the shared framework sequence (DEC-H3 unification):
  // endSession + resetGpsSessionData + coordinator reset.
  teardownArSessionState(store);
}
