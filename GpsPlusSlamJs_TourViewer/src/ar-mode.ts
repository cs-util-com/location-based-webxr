/**
 * The M2 AR foundation of the QR-pose loop: pure view mapping for the AR
 * entry button, the `enable()` configuration both modes share, and the
 * on-running runtime start (session → alignment → camera capture). Plan:
 * gps-plus-slam `GpsPlusSlamJs_Docs/docs/2026-08-25-1227-qr-pose-tour-`
 * `relocalization-plan.md` §3 M2.
 *
 * Both modes are deliberately IDENTICAL down here (QD-5/delta #7): QR
 * detection needs camera frames everywhere, so camera access + texture
 * acquisition are ON in viewer AND author mode, and depth stays OFF in both
 * (v1 authoring takes the printed size as an input, which dissolved the
 * per-mode depth split). Author mode only changes labels here; the pipelines
 * diverge in M3/M4.
 */

import type {
  ArSessionCallbacks,
  EnableGpsArConfig,
  EnableGpsArState,
  RgbaImage,
} from "gps-plus-slam-app-framework/ar";
import type {
  GpsPosition,
  RawDeviceOrientation,
} from "gps-plus-slam-app-framework/sensors";
import {
  endSession,
  resetCoordinatorState,
  resetGpsSessionData,
  startSession,
  type SubscribableStore,
} from "gps-plus-slam-app-framework/state";
import type { Object3D } from "three";

/**
 * Camera-frame cadence (~8 Hz, the detection cadence the QR plan budgets
 * for). The frame source is the SINGLE cadence owner (Option A): the QR
 * controller that will consume these frames in M3/M4 must run
 * `minIntervalMs: 0`, because two equal throttles in series drop ~1 frame
 * per cycle.
 */
export const CAMERA_FRAME_INTERVAL_MS = 125;

export interface ArButtonView {
  label: string;
  disabled: boolean;
}

/** The mode-independent states (author mode only relabels ready/running). */
const STATIC_BUTTON_VIEWS: Record<
  "checking" | "unsupported" | "starting" | "stopping",
  ArButtonView
> = {
  checking: { label: "Checking AR support…", disabled: true },
  unsupported: { label: "AR not supported on this device", disabled: true },
  starting: { label: "Starting…", disabled: true },
  stopping: { label: "Stopping…", disabled: true },
};

/** Pure state → button mapping (MinimalExample's `buttonView` pattern). */
export function arButtonView(
  state: EnableGpsArState,
  authorMode: boolean,
): ArButtonView {
  switch (state.status) {
    case "ready":
      return {
        label: authorMode ? "Start AR authoring" : "Start AR view",
        disabled: false,
      };
    case "running":
      return {
        label: authorMode ? "Authoring in AR" : "AR running",
        disabled: true,
      };
    case "error":
      return {
        label: `Retry — ${state.error ?? "failed to start"}`,
        disabled: false,
      };
    default:
      return STATIC_BUTTON_VIEWS[state.status];
  }
}

/** The app-side hooks the enable configuration forwards into. */
export interface ArEnableHooks {
  container: HTMLElement;
  /** Every throttled camera frame (top-left RGBA) — the future QR feed. */
  onFrame(image: RgbaImage): void;
  onSessionEnd(): void;
  onGpsPosition(position: GpsPosition): void;
  onOrientation(orientation: RawDeviceOrientation): void;
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
      onFrame: (image) => {
        hooks.onFrame(image);
      },
    },
    onSessionEnd: () => {
      hooks.onSessionEnd();
    },
  };
  return {
    container: hooks.container,
    // Camera ON (access + texture acquisition), depth OFF — in BOTH modes.
    // These are the opposite of MinimalExample/AnchorStarter, which turn the
    // camera path off to dodge its Chromium crash surface; a CV app needs it
    // and inherits that surface (mitigated by the framework's projection-
    // layer workaround inside initAR).
    isolationOptions: {
      enableCameraAccess: true,
      enableDepthSensingFeature: false,
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
  store.dispatch(endSession());
  store.dispatch(resetGpsSessionData());
  resetCoordinatorState();
}
