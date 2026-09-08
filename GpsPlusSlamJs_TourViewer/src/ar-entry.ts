/**
 * The AR entry (QR-pose plan M2): the one `enable()` both modes share, the
 * on-running runtime start, the session-end teardown, and the two renderers
 * of the entry's DOM (`#enter-ar`, `#ar-hint`, `#ar-status`). Its own module
 * since the flows plan M6. Author mode (`?author=1`) is read once at boot;
 * switching is a page reload (the controller refuses enable() while a
 * session runs).
 */

import type { EnableGpsArState } from "gps-plus-slam-app-framework/ar";
import type { GpsPosition } from "gps-plus-slam-app-framework/sensors";
import {
  clearAllQrMarkers,
  computeOnboardingGuidance,
  selectGpsPositions,
  selectTrackingQuality,
  updateDeviceOrientation,
} from "gps-plus-slam-app-framework/state";

import {
  arButtonView,
  buildArEnableConfig,
  endTourArRuntime,
  startTourArRuntime,
} from "./ar-mode.js";
import { describeOpenError } from "./open-errors.js";
import type { TourViewerSeams } from "./seams.js";
import { arStatusLine } from "./tour-flow.js";
import type {
  ArController,
  TourViewerHooks,
  TourViewerSession,
  TourViewerStore,
} from "./tour-viewer-session.js";

export interface ArEntryDom {
  /** The initAR container = the WebXR DOM-overlay root. */
  arRoot: HTMLElement;
  arStatus: HTMLDivElement;
  arHint: HTMLParagraphElement;
  enterArButton: HTMLButtonElement;
  /** The printed-size input (print panel) - frozen during an AUTHOR session. */
  sizeInput: HTMLInputElement;
  errorBox: HTMLElement;
}

/** A property, not a method: it is handed to the hooks object unbound. */
export interface ArEntry {
  renderArStatus: () => void;
}

export function wireArEntry(deps: {
  ctx: TourViewerSession;
  authorMode: boolean;
  arStore: TourViewerStore;
  arController: ArController;
  gpsHandler: (position: GpsPosition) => void;
  seams: TourViewerSeams;
  dom: ArEntryDom;
  hooks: TourViewerHooks;
}): ArEntry {
  const {
    ctx,
    authorMode,
    arStore,
    arController,
    gpsHandler,
    seams,
    dom,
    hooks,
  } = deps;

  function renderArStatus(): void {
    dom.arStatus.textContent = arStatusLine({
      authorMode,
      arStatus: arController.getState().status,
      cameraFrames: ctx.cameraFrameCount,
      tour:
        ctx.session === null
          ? { kind: "none" }
          : {
              kind: "open",
              levelCount: ctx.currentLevels?.size ?? null,
            },
      qr: {
        status: ctx.viewerQrStatus,
        unknownCode: ctx.viewerUnknownCode,
        unusableCode: ctx.viewerUnusableCode,
        votedLocks: ctx.viewerVotedLocks,
        lockedText: ctx.viewerLockedText,
        reprojectionErrorPx: ctx.viewerReprojectionPx,
      },
      // The onboarding mapping of the tracking-quality report - `null`
      // before the slice reports maps to the `initializing` hint, which is
      // the right copy while waiting. Author mode never reads readiness.
      readiness: authorMode
        ? null
        : computeOnboardingGuidance(selectTrackingQuality(arStore.getState())),
      placement: ctx.placement,
      planesError: ctx.viewerPlanesError,
    });
  }

  function renderArState(state: EnableGpsArState): void {
    const view = arButtonView(state, authorMode);
    dom.enterArButton.disabled = view.disabled;
    dom.enterArButton.textContent = view.label;
    // The printed size is CAPTURED at AR entry (the solves use it) — editing
    // it mid-session would stamp a size the pose was never solved with
    // (milestone review #3).
    const sessionActive =
      state.status === "starting" ||
      state.status === "running" ||
      state.status === "stopping";
    // Author mode only: a viewer session does not consume the size, and the
    // input is a creator's print field now (flows plan M3, DEC-F2).
    dom.sizeInput.disabled = authorMode && sessionActive;
    // `#ar-root` IS the DOM overlay, so anything left visible in it sits
    // over the camera feed for the whole session. The hint explains the
    // button before a press; during a session it would be a start-screen
    // instruction pinned over live video (milestone review, 2026-09-05).
    dom.arHint.hidden = sessionActive;
    renderArStatus();
  }

  function onSessionEnd(): void {
    // Full teardown, not just capture stop: the AR entry is re-enterable,
    // and an open recording would blend the dead session's odom frame into
    // the next alignment (PR #359 review). The QR window and its tracked
    // text are session state too — a re-entry must not mint from the dead
    // session's odom-frame poses (milestone review #2).
    ctx.qrController = null;
    ctx.qrDebugView?.dispose();
    ctx.qrDebugView = null;
    ctx.lastDetectedText = null;
    ctx.authorErrorText = null;
    ctx.imagePlanes?.dispose();
    ctx.imagePlanes = null;
    ctx.viewerQrStatus = null;
    ctx.viewerUnknownCode = null;
    ctx.viewerUnusableCode = null;
    ctx.viewerVotedLocks = 0;
    ctx.viewerLockedText = null;
    ctx.viewerReprojectionPx = null;
    ctx.placement = { kind: "idle" };
    ctx.viewerPlanesError = null;
    ctx.imagePlanesLoading = false;
    // The placement trigger is session state: unsubscribe, and let the next
    // entry attempt again once ITS tracking reports ready (flows plan M4,
    // review #12 - per-entry re-placement by design).
    ctx.placementUnsubscribe?.();
    ctx.placementUnsubscribe = null;
    ctx.placementAttempted = false;
    ctx.joinDeclined = false;
    // Invalidate any join still awaiting: it cannot be cancelled, but every
    // post-await guard checks this token, so a stale run frees its textures
    // instead of planting planes into a dead scene and clobbering the next
    // session's latch (milestone review, finding 6 — the join's
    // tens-of-seconds decode turned this race from theoretical into
    // expected).
    ctx.planesRunGeneration += 1;
    arStore.dispatch(clearAllQrMarkers());
    endTourArRuntime(arStore, {
      stopCameraFrameCapture: () => {
        seams.stopCameraFrameCapture();
      },
    });
    renderArStatus();
    hooks.renderAuthorReadout();
  }

  async function enterAr(): Promise<void> {
    ctx.cameraFrameCount = 0;
    // A refused AUTHOR pipeline (bad size, no detector) keeps AR unstarted —
    // the message is already in the author panel, where the author is
    // looking. The viewer pipeline is best-effort: without a detector the
    // session is plain AR.
    if (authorMode && !hooks.startAuthorPipeline()) return;
    if (!authorMode) hooks.startViewerPipeline();
    const result = await arController.enable(
      buildArEnableConfig({
        container: dom.arRoot,
        trackingStore: arStore,
        onFrame: (image) => {
          ctx.cameraFrameCount += 1;
          ctx.qrController?.offerFrame(image);
          renderArStatus();
        },
        onSessionEnd,
        onGpsPosition: (position) => {
          gpsHandler(position);
        },
        onOrientation: (orientation) => {
          updateDeviceOrientation(orientation);
        },
      }),
    );
    // Failure states surface via the subscribed button view (Retry — <reason>).
    if (!result.ok) return;
    const runtime = startTourArRuntime(arStore, {
      getArWorldGroup: () => seams.getArWorldGroup(),
      enableArWorldGroupAlignment: (options) =>
        seams.enableArWorldGroupAlignment(options),
      startCameraFrameCapture: (config) => {
        seams.startCameraFrameCapture(config);
      },
      now: Date.now,
    });
    if (!runtime.ok) {
      dom.errorBox.textContent = runtime.error;
      await arController.disable();
      return;
    }
    // The world group exists only AFTER initAR built the scene graph —
    // creating the glue check earlier made it dead code in production
    // (PR #360 review). The snapshot for the alignment gate belongs to the
    // same moment: this session's fixes start counting now.
    ctx.gpsSamplesAtSessionStart = selectGpsPositions(
      arStore.getState(),
    ).length;
    // BOTH modes glue the marker to detections — the author's accuracy check
    // and the viewer's "it relocalized" proof are the same axis+cube.
    const worldGroup = seams.getArWorldGroup();
    if (worldGroup !== null) {
      ctx.qrDebugView = seams.createQrDebugView(worldGroup);
    }
    if (authorMode) {
      hooks.renderAuthorReadout();
      return;
    }
    // The ready-triggered placement (flows plan M4, DEC-F3): attempt on
    // every dispatch while the session lives - `tryPlaceTour` is a few
    // predicate reads until the tracking-quality phase is `ready`, then
    // runs once.
    ctx.placementAttempted = false;
    ctx.joinDeclined = false;
    ctx.placementUnsubscribe = arStore.subscribe(() => {
      hooks.tryPlaceTour();
    });
    hooks.tryPlaceTour();
    renderArStatus();
  }

  arController.subscribe(renderArState);
  renderArState(arController.getState());
  void arController.refreshSupport();
  dom.enterArButton.addEventListener("click", () => {
    // Defensive: enable() reports failures via its state machine, but a
    // rejection anywhere else (e.g. the rollback disable()) must reach the
    // error box, not die as an unhandled rejection.
    enterAr().catch((err: unknown) => {
      dom.errorBox.textContent = describeOpenError(err);
    });
  });

  return { renderArStatus };
}
