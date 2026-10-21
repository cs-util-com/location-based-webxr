/**
 * The AR entry (QR-pose plan M2): the one `enable()` both modes share, the
 * on-running runtime start, the session-end teardown, and the two renderers
 * of the entry's DOM (`#enter-ar`, `#ar-hint`, `#ar-status`). Its own module
 * since the flows plan M6. The mode (creator setup or visitor, DEC-N1) is
 * read once at boot; switching is a page reload (the controller refuses
 * enable() while a session runs). A visitor's tap consults the location
 * gate first (DEC-N2): while the geolocation permission is not known to be
 * granted, the tap requests the position and the NEXT tap starts AR.
 */

import { copyWithFeedback } from "gps-plus-slam-app-framework/utils/copy-with-feedback";
import type { EnableGpsArState } from "gps-plus-slam-app-framework/ar";
import {
  GPS_POINT_SOURCE_DEVICE,
  gpsPointSourceOf,
} from "gps-plus-slam-app-framework/core";
import type { GpsPosition } from "gps-plus-slam-app-framework/sensors";
import { createGpsExtentTracker } from "gps-plus-slam-app-framework/state/gps-extent-tracker";
import {
  type DepthSample,
  clearAllQrMarkers,
  computeOnboardingGuidance,
  recordDepthSample,
  selectGpsPositions,
  selectTrackingQuality,
  updateDeviceOrientation,
} from "gps-plus-slam-app-framework/state";

import {
  arButtonView,
  COPY_LINK_LABELS,
  visitorStep,
  buildArEnableConfig,
  type ArEnableHooks,
  endTourArRuntime,
  startTourArRuntime,
} from "./ar-mode.js";
import type { DepthSamplerConfig } from "gps-plus-slam-app-framework/ar/depth-sampler";
import { createLogger } from "gps-plus-slam-app-framework/utils/logger";
import type { Object3D } from "three";
import { RECORDING_DEPTH } from "./authoring-recording.js";
import {
  MESH_DEPTH,
  meshSurfaceLine,
  type MeshSurface,
} from "./mesh-surface.js";
import type { ViewerMode } from "./mode.js";
import { describeOpenError } from "./open-errors.js";
import { debugReadoutLines, visitorFusedHint } from "./qr-debug-readout.js";
import type { TourViewerSeams } from "./seams.js";
import { contentStatus } from "./station-content.js";
import { arStatusLine, type ArStatusInput } from "./tour-flow.js";
import { scanCardShown } from "./scan-gate.js";
import {
  FIND_CODE,
  statusSentence,
  visitorStatusParts,
} from "./visitor-status.js";
import { walkStatusRouting } from "./walk-status-routing.js";
import type { WalkToast } from "./walk-toast.js";
import { tourUnfinished } from "./tour-unfinished.js";
import {
  selectHeadingPending,
  selectPresentStationId,
} from "./visitor-guide-slice.js";
import type { LocationGate } from "./visitor-screen.js";
import type { RecordingPanel } from "./recording-panel.js";
import {
  endQrPipeline,
  isCodeIgnored,
  type ArController,
  type TourViewerHooks,
  type TourViewerSession,
  type TourViewerStore,
} from "./tour-viewer-session.js";

const log = createLogger("ArEntry");

export interface ArEntryDom {
  /** The initAR container = the WebXR DOM-overlay root. */
  arRoot: HTMLElement;
  arStatus: HTMLDivElement;
  arHint: HTMLParagraphElement;
  enterArButton: HTMLButtonElement;
  /** The printed-size input (print panel) - frozen during an AUTHOR session. */
  sizeInput: HTMLInputElement;
  errorBox: HTMLElement;
  /** The scan gate's escape (inside the overlay); hidden until offered. */
  escapeButton: HTMLButtonElement;
  /** The `?debug=1` QR readout (plan §66); written only while `ctx.debug`. */
  arDebug?: HTMLElement;
  /** The screen reader's copy of the visitor's sentence (UI round 1, U1,
   *  review F14): written only when the sentence changes, never per camera
   *  frame like the visible line. */
  arStatusLive?: HTMLElement;
  /** The visitor's scan card (polish round M4b) and its sentence line.
   *  Absent: no card (the node tests that do not need one). */
  scanCard?: Pick<HTMLElement, "hidden" | "dataset">;
  scanCardLine?: Pick<HTMLElement, "textContent">;
  /** The card's title: it reads "Code found - placing the tour…" in the
   *  card's found look (visitor walk W4 build plan M2, §1.4). */
  scanCardTitle?: Pick<HTMLElement, "textContent">;
  /** The visitor's coach in AR (W4 build plan M2, §1.4): the centred card
   *  for a short wait, a tracking hint, or a state with no walk to show. */
  coach?: {
    root: Pick<HTMLElement, "hidden" | "dataset">;
    text: Pick<HTMLElement, "textContent">;
  };
  /** The peek's line asking for the code (W4: in the peek, not over the
   *  camera). */
  codeTail?: Pick<HTMLElement, "hidden" | "textContent">;
}

/** The scan card's two titles (W4 build plan M2, §1.4; the first kept). */
const SCAN_CARD_TITLE = "Scan the code again so the tour can start";
const SCAN_CARD_FOUND_TITLE = "Code found - placing the tour…";

/** Properties, not methods: they are handed to the hooks object unbound. */
export interface ArEntry {
  renderArStatus: () => void;
  /** Re-render the button from the controller state and the location gate. */
  renderArEntry: () => void;
}

export function wireArEntry(deps: {
  ctx: TourViewerSession;
  mode: ViewerMode;
  arStore: TourViewerStore;
  arController: ArController;
  gpsHandler: (position: GpsPosition) => void;
  seams: TourViewerSeams;
  locationGate: LocationGate;
  dom: ArEntryDom;
  hooks: TourViewerHooks;
  /** The creator's troubleshooting recording (authoring recording plan
   *  2026-09-28-0953, M1a): asked at each entry whether it records. */
  recording?: Pick<RecordingPanel, "beginOnArEntry">;
  /** A creator's ring follows a mesh of the surroundings (polish round
   *  M5, Q-Mesh; `main.ts` turns it on unless `?mesh=0`). */
  meshCursor?: boolean;
  /** The visitor's walk (W4 build plan M2): the toast its news goes to,
   *  and whether the visitor left AR with progress on the open tour (the
   *  start then reads "Back to the tour"). */
  walk?: {
    toast: WalkToast;
    progressKept(): boolean;
    /** The walk's sheet shows now (the station guide runs). */
    sheetShown?(): boolean;
  };
}): ArEntry {
  const {
    ctx,
    mode,
    arStore,
    arController,
    gpsHandler,
    seams,
    locationGate,
    dom,
    hooks,
  } = deps;
  const authorMode = mode === "creator";
  /** Whether this visit's first tap asked for the location: the button
   *  then reads as step 2 of 2 (polish round M4a, the owner's V4). */
  let hadLocationStep = false;
  /** A Copy link tap is running: it owns the button's label until then. */
  let copying = false;
  /** Whether THIS session's depth sampler was started (a recorded entry). */
  let depthRunning = false;
  /** Whether that sampler serves a recorded entry (the readout's line);
   *  the mesh cursor runs it too (polish round M5). */
  let depthRecorded = false;
  /** The creator's mesh of the surroundings (M5; off with `?mesh=0`). */
  let meshSurface: MeshSurface | null = null;
  /** The device fixes' extent, for the ?debug=1 GPS line (polish round C4). */
  const gpsExtent = createGpsExtentTracker();
  /** That line's inputs, recomputed only when the GPS list changed: the
   *  block re-renders on every frame. */
  let gpsQualityFor: unknown = null;
  let gpsQuality: {
    accuracyM: number | null;
    extentM: number | null;
    fixes: number;
  } = { accuracyM: null, extentM: null, fixes: 0 };

  /**
   * The recording's part of an AR entry (authoring recording plan
   * 2026-09-28-0953, M1a): asked BEFORE the session is requested, so the
   * recording (when the creator opted in) holds this entry's `startSession`
   * as its first action, and depth - a feature the session asks for up front
   * (decision D4) - is requested only for a recorded entry. Its samples are
   * dispatched as the Recorder dispatches them: as-is, into the stream.
   */
  function recordedEntryHooks(): Pick<ArEnableHooks, "onDepthSample"> {
    if (deps.recording?.beginOnArEntry() !== true) return {};
    return {
      onDepthSample: (sample: DepthSample) => {
        arStore.dispatch(recordDepthSample(sample));
      },
    };
  }

  /** The depth this entry asks for: a recorded entry's at the recording's
   *  density (its byte estimate assumes it), else a creator's with the
   *  mesh cursor at the mesh's (polish round M5), else none - depth stays
   *  off otherwise (QD-5). Either feeds the store's latest depth sample. */
  function entryDepth(): {
    hooks: Pick<ArEnableHooks, "onDepthSample">;
    config: Partial<DepthSamplerConfig> | null;
    recorded: boolean;
  } {
    const recorded = recordedEntryHooks();
    if (recorded.onDepthSample !== undefined) {
      return { hooks: recorded, config: RECORDING_DEPTH, recorded: true };
    }
    if (authorMode && deps.meshCursor === true) {
      return {
        hooks: {
          onDepthSample: (sample: DepthSample) => {
            arStore.dispatch(recordDepthSample(sample));
          },
        },
        config: MESH_DEPTH,
        recorded: false,
      };
    }
    return { hooks: {}, config: null, recorded: false };
  }

  /** Once the runtime runs: start the sampler the entry asked for. */
  function startEntryDepth(depth: ReturnType<typeof entryDepth>): void {
    if (depth.config === null) return;
    seams.startDepthCapture(depth.config);
    depthRunning = true;
    depthRecorded = depth.recorded;
  }

  /** The creator's mesh, or null when it cannot be built (no worker
   *  support, a failing mesher): the ring then runs on the hit-test alone,
   *  as without the flag (M5 review #11). */
  function startMeshSurfaceSafely(worldGroup: Object3D): MeshSurface | null {
    try {
      return seams.startMeshSurface(worldGroup, arStore);
    } catch (err) {
      log.warn("Mesh cursor unavailable; the ring follows the hit-test", err);
      return null;
    }
  }

  /** Whether the scan card shows the gate's wait now. */
  function scanWaitShown(input: ArStatusInput): boolean {
    return scanCardShown(
      mode,
      input.arStatus,
      ctx.scanGate,
      input.tour.kind === "open" && input.tour.unfinished !== undefined,
    );
  }

  /** The scan card shows the visitor's sentence while the gate waits, and
   *  "Code found - placing the tour…" with a check once the code passed
   *  it (W4, `found`); the status line steps aside meanwhile (kept with
   *  ?debug=1, whose technical line the card does not carry). */
  function renderScanCard(
    shown: boolean,
    found: boolean,
    sentence: string,
  ): void {
    const visible = shown || found;
    if (dom.scanCard !== undefined) {
      dom.scanCard.hidden = !visible;
      dom.scanCard.dataset["look"] = found && !shown ? "found" : "scan";
    }
    if (dom.scanCardTitle !== undefined) {
      const title = found && !shown ? SCAN_CARD_FOUND_TITLE : SCAN_CARD_TITLE;
      if (dom.scanCardTitle.textContent !== title) {
        dom.scanCardTitle.textContent = title;
      }
    }
    if (dom.scanCardLine !== undefined) {
      dom.scanCardLine.textContent = shown ? sentence : "";
    }
    dom.arStatus.hidden = visible && !ctx.debug;
  }

  /** The walk's surfaces for a visitor's sentence (W4 build plan M2,
   *  §1.4): the coach, the toast's news, the peek's code line. The
   *  sentence itself stays on `#ar-status` and its live copy. */
  function renderWalkRoute(
    route: ReturnType<typeof walkStatusRouting>,
    running: boolean,
  ): void {
    if (dom.coach !== undefined) {
      const coach = route.coach;
      dom.coach.root.hidden = coach === null;
      if (coach === null) delete dom.coach.root.dataset["look"];
      else dom.coach.root.dataset["look"] = coach.look;
      const text = coach?.text ?? "";
      if (dom.coach.text.textContent !== text)
        dom.coach.text.textContent = text;
    }
    if (dom.codeTail !== undefined) {
      dom.codeTail.hidden = !route.codeTail;
      const text = route.codeTail ? FIND_CODE : "";
      if (dom.codeTail.textContent !== text) dom.codeTail.textContent = text;
    }
    // News is said in AR only: the toast's place is over the camera.
    if (running)
      for (const news of route.toasts) deps.walk?.toast.sayOnce(news);
  }

  /** A visitor's tour that is not finished yet (`tour-unfinished.ts`),
   *  once its manifest settled; a creator's tour is the one being made. */
  function unfinishedTour(): {
    unfinished?: { readonly contact: string | undefined };
  } {
    if (mode !== "visitor" || ctx.tourManifestStatus !== "settled") return {};
    const manifest = ctx.tourDocument.manifest();
    return tourUnfinished(manifest)
      ? { unfinished: { contact: manifest?.contact } }
      : {};
  }

  /** A visitor's open tour has nothing to show yet: no Start is offered
   *  (no location asked, no empty session) - the start page says why. */
  function startWithheld(): boolean {
    return ctx.session !== null && unfinishedTour().unfinished !== undefined;
  }

  function renderArStatus(): void {
    renderDebugReadout();
    const input: ArStatusInput = {
      mode,
      arStatus: arController.getState().status,
      arError: arController.getState().error ?? null,
      cameraFrames: ctx.cameraFrameCount,
      codesOnly: ctx.codesOnly,
      tour:
        ctx.session === null
          ? { kind: "none" }
          : {
              kind: "open",
              levelCount: ctx.currentLevels?.size ?? null,
              ...unfinishedTour(),
            },
      qr: {
        status: ctx.viewerQrStatus,
        unknownCode: ctx.viewerUnknownCode,
        unusableCode: ctx.viewerUnusableCode,
        votedLocks: ctx.viewerVotedLocks,
        lockedText: ctx.viewerLockedText,
        reprojectionErrorPx: ctx.viewerReprojectionPx,
        // The code keep-alive's phase at render time (it counts down).
        hold: ctx.viewerKeepAlive?.phase(Date.now()) ?? null,
        // Device fixes only (votes excluded): with none, no GPS hand-over
        // is claimed (QR-first M1 review #4).
        deviceFixes: sessionGpsQuality().fixes,
        // A code the moved-code check ignores (D20, M5c).
        ignoredCode: ctx.viewerIgnoredText,
        // Read from the last evaluation, never re-evaluated here: this runs
        // per camera frame, past the budget's short-circuit (plan §67 #5).
        // Never an ignored code's: its veto set the votes back to 0, and
        // "placing the tour" is a promise it cannot keep; another code's
        // hint still shows (r881 re-review L-F, L1). Ignored is the veto
        // memory (every vetoed code of the tour, across AR entries), not
        // the line's latest veto.
        fusedHint:
          authorMode ||
          (ctx.viewerLastEvaluation !== null &&
            isCodeIgnored(ctx, ctx.viewerLastEvaluation.text))
            ? null
            : visitorFusedHint({
                last: ctx.viewerLastEvaluation,
                status: ctx.viewerQrStatus,
                nowMs: performance.now(),
              }),
      },
      // The onboarding mapping of the tracking-quality report - `null`
      // before the slice reports maps to the `initializing` hint, which is
      // the right copy while waiting. Author mode never reads readiness.
      readiness: authorMode
        ? null
        : computeOnboardingGuidance(selectTrackingQuality(arStore.getState())),
      placement: ctx.placement,
      contentError: ctx.contentError,
      gate: ctx.scanGate,
      // The tour's items, counted for the stations shown now (visitor plan
      // 2026-10-18-2349 §3: the present station's, not the tour's).
      content: contentStatus(ctx.stationContent),
      // The visitor guide waits for a heading (D34): the store's flag. No
      // creator guard: the guide never runs for a creator (its placement
      // needs visitor mode, `stationPlacementAllowed`), and only
      // `visitorStatus` reads the flag, whose sentence a creator never sees.
      stationsAwaitHeading: selectHeadingPending(arStore.getState()),
      // Content drawn per station leaves nothing in view between them.
      // A present station may draw nothing (only a story or a figure):
      // the visitor is at a station then, never away.
      awayFromStations:
        ctx.stationContent !== null &&
        !ctx.stationContent.showsAny() &&
        selectPresentStationId(arStore.getState()) === null,
    };
    // A visitor reads one plain sentence (UI round 1, U1); the technical
    // line stays for the creator and for a visitor's `?debug=1`. The state
    // name is the stable channel for the page's styling and the tests.
    const parts = visitorStatusParts(input);
    const plain = statusSentence(parts);
    const visitor = mode === "visitor";
    const line = visitor && !ctx.debug ? plain.text : arStatusLine(input);
    dom.arStatus.textContent = line;
    const shown = scanWaitShown(input);
    // The walk's surfaces are a visitor's (a creator keeps the line).
    const route = visitor
      ? walkStatusRouting(parts, shown, deps.walk?.sheetShown?.() === true)
      : null;
    renderScanCard(shown, route?.scanCard === "found", plain.text);
    if (route !== null) renderWalkRoute(route, input.arStatus === "running");
    // The visitor's state machine only (a creator's would mislead), and
    // the gate for both (U1 milestone review #8, #9).
    if (visitor) dom.arStatus.dataset.state = plain.state;
    else delete dom.arStatus.dataset.state;
    dom.arStatus.dataset.gate = gateName(ctx.scanGate);
    // The live region: the visitor's sentence, and a creator's line only
    // outside a session - inside one it changes with every camera frame.
    const live = visitor
      ? plain.text
      : input.arStatus === "running"
        ? null
        : line;
    if (
      live !== null &&
      dom.arStatusLive !== undefined &&
      dom.arStatusLive.textContent !== live
    ) {
      dom.arStatusLive.textContent = live;
    }
  }

  /** The scan gate as one word (`data-gate`): "passed-code" proves the
   *  CODE passed it, not GPS. */
  function gateName(gate: TourViewerSession["scanGate"]): string {
    if (gate.kind === "passed") return `passed-${gate.via}`;
    if (gate.kind === "not-required") return `not-required-${gate.reason}`;
    return gate.kind;
  }

  /** The session's GPS quality from DEVICE fixes only: the store's median
   *  folds the code's synthetic votes in, which would make poor indoor GPS
   *  read about 5 m (polish round C4). */
  function sessionGpsQuality(): typeof gpsQuality {
    const positions = selectGpsPositions(arStore.getState());
    if (positions === gpsQualityFor) return gpsQuality;
    gpsQualityFor = positions;
    const accuracies = positions
      .filter((p) => gpsPointSourceOf(p) === GPS_POINT_SOURCE_DEVICE)
      .map((p) => p.latLongAccuracy)
      .filter((a): a is number => typeof a === "number" && Number.isFinite(a))
      .sort((a, b) => a - b);
    gpsQuality = {
      accuracyM:
        accuracies.length === 0 ? null : accuracies[accuracies.length >> 1]!,
      extentM: gpsExtent.update(positions),
      // Fixes WITH an accuracy are all the fixes there are: the store keeps
      // no fix without one (ar-entry.test.ts pins it; PR #583 review).
      fixes: accuracies.length,
    };
    return gpsQuality;
  }

  /** The ?debug=1 block: the controller state and each code's counts. */
  function renderDebugReadout(): void {
    if (!ctx.debug || dom.arDebug === undefined) return;
    dom.arDebug.textContent = debugReadoutLines({
      // The controller's own status: the creator pipeline never writes
      // `viewerQrStatus` (milestone review of b4c #2).
      status: ctx.qrController?.status ?? null,
      unknownCode: ctx.viewerUnknownCode,
      unusableCode: ctx.viewerUnusableCode,
      tallies: ctx.fusedTallies,
      movedCodeChecks: ctx.movedCodeChecks?.snapshot() ?? [],
      ignoredCodes: [...ctx.ignoredCodes.values()].map((c) => c.text),
      gps: sessionGpsQuality(),
      // A recorded entry's sampler (the mesh cursor's is not a recording).
      recordingOn: depthRecorded,
    })
      // With the mesh running, the frame time the owner judges it by
      // (Q-Mesh; ?mesh=0 has no line - F13).
      .concat(
        meshSurface === null ? [] : [meshSurfaceLine(meshSurface.stats())],
      )
      .join("\n");
  }

  /** The entry button: its label (left alone while a copy runs - the copy
   *  owns it until it settles), the state for the page's CSS (V4 restyles
   *  a phone without AR), and the step marker of V4's round button, which
   *  the accessible name carries too: generated content would be read run
   *  into the label (M4 review #11). */
  function renderButton(
    state: EnableGpsArState,
    location: { pending: boolean; busy: boolean },
  ): void {
    const button = dom.enterArButton;
    const view = arButtonView(
      state,
      mode,
      location,
      {
        running: ctx.finishing,
        failed: ctx.finishError !== null,
      },
      deps.walk?.progressKept() ?? false,
    );
    if (!copying) {
      button.disabled = view.disabled;
      button.textContent = view.label;
    }
    button.dataset["arState"] = state.status;
    const step = visitorStep(mode, state, location, hadLocationStep);
    if (step === null) {
      delete button.dataset["step"];
      button.removeAttribute("aria-label");
    } else {
      button.dataset["step"] = step;
      button.setAttribute("aria-label", `${view.label}, step ${step}`);
    }
  }

  function renderArState(state: EnableGpsArState): void {
    const location = {
      pending: locationGate.pending(),
      busy: locationGate.busy(),
    };
    renderButton(state, location);
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
    // The page's one flag for "a session is up". Step 4 is a <details>
    // since F4, and its content is `#ar-root` - so the CSS keyed on this
    // takes the summary away while a session runs, because a collapsed
    // step 4 renders no overlay at all. `wizard.ts` holds the other half
    // (nothing may assign `open = false` on it meanwhile).
    document.body.dataset["arActive"] = String(sessionActive);
    // The setup panel's controls and its readout follow the same boolean,
    // and they are rendered from here so they cannot lag the state they
    // describe (the controller is the only thing that knows).
    hooks.renderAuthorReadout();
    // `#ar-root` IS the DOM overlay, so anything left visible in it sits
    // over the camera feed for the whole session. The hint explains the
    // button before a press; during a session it would be a start-screen
    // instruction pinned over live video (milestone review, 2026-09-05).
    // A visitor's phone without AR gets no "once AR starts" hint: the
    // status line says what to do instead (polish round M4a, V4).
    // A visitor's tour not finished yet gets neither the button nor its
    // hint; during a session the button stays, as the way out.
    const withheld = !sessionActive && startWithheld();
    dom.enterArButton.hidden = withheld;
    // The page's CSS reads it: "What happens?" describes a session this
    // visitor cannot start, so it goes too (index.html).
    dom.enterArButton.dataset["start"] = withheld ? "withheld" : "offered";
    dom.arHint.hidden =
      withheld ||
      sessionActive ||
      (!authorMode && state.status === "unsupported");
    renderArStatus();
  }

  function onSessionEnd(): void {
    // FIRST, while the visit is still the current one and the store still
    // holds its alignment: the creator's settle reads both, and the
    // teardown at the end of this function resets the alignment
    // (authoring plan 2026-09-28-0953 §3.2, M2c; a test pins the order).
    if (authorMode) hooks.endAuthorVisit();
    ctx.arSessionGeneration += 1;
    // Full teardown, not just capture stop: the AR entry is re-enterable,
    // and an open recording would blend the dead session's odom frame into
    // the next alignment (PR #359 review). The QR window and its tracked
    // text are session state too — a re-entry must not mint from the dead
    // session's odom-frame poses (milestone review #2). Disposed, not just
    // dropped: a lock still in flight must not land in the next session.
    endQrPipeline(ctx);
    ctx.qrDebugView?.dispose();
    ctx.qrDebugView = null;
    ctx.lastDetectedText = null;
    ctx.printSizeCheck?.reset();
    ctx.authorErrorText = null;
    // The measured level SURVIVES the session end on purpose: finishing
    // ends the session itself (the download is a page-side tap). A new
    // measurement replaces it (mintGeneration).
    ctx.reticle?.dispose();
    ctx.reticle = null;
    ctx.latestFrame = null;
    for (const preview of ctx.placedPreviews.values()) preview.dispose();
    ctx.placedPreviews.clear();
    // The gate and the placed content are session state (M5).
    ctx.cancelEscapeClock?.();
    ctx.cancelEscapeClock = null;
    ctx.scanGate = { kind: "idle" };
    ctx.stationContent?.dispose();
    ctx.stationContent = null;
    ctx.contentAttempted = false;
    ctx.contentError = null;
    // The placement trigger goes first: the guide's teardown below may
    // still publish (a gate or presence change), and a live trigger would
    // answer it with a placement attempt into the dying session.
    ctx.placementUnsubscribe?.();
    ctx.placementUnsubscribe = null;
    // The story stops with the session; the station progress stays.
    hooks.stopStations();
    // The toast goes with the session; the next entry may say it again.
    deps.walk?.toast.reset();
    dom.escapeButton.hidden = true;
    ctx.viewerQrStatus = null;
    ctx.viewerUnknownCode = null;
    ctx.viewerUnusableCode = null;
    ctx.viewerVotedLocks = 0;
    ctx.viewerLockedText = null;
    ctx.viewerReprojectionPx = null;
    ctx.viewerLastEvaluation = null;
    ctx.placement = { kind: "idle" };
    // The placement trigger is session state (unsubscribed above, before
    // the guide's teardown): let the next entry attempt again once ITS
    // tracking reports ready (flows plan M4, review #12 - per-entry
    // re-placement by design).
    ctx.placementAttempted = false;
    if (depthRunning) {
      seams.stopDepthCapture();
      depthRunning = false;
      depthRecorded = false;
    }
    meshSurface?.dispose();
    meshSurface = null;
    arStore.dispatch(clearAllQrMarkers());
    endTourArRuntime(arStore, {
      stopCameraFrameCapture: () => {
        seams.stopCameraFrameCapture();
      },
    });
    renderArStatus();
    hooks.renderAuthorReadout();
  }

  /** The visitor's Copy link tap (async-UI rule: busy, then the outcome;
   *  a failure on the error line, with the address bar as the way out). */
  function copyLink(): void {
    copying = true;
    // The framework's one copy sequence (F7, DEC-H3): the write inside the
    // chain, so a page without a clipboard fails instead of sticking at
    // "Copying…" (M4 review #1).
    void copyWithFeedback(
      dom.enterArButton,
      location.href,
      (text) => seams.copyText(text),
      {
        busy: COPY_LINK_LABELS.busy,
        done: COPY_LINK_LABELS.done,
        // The advice goes on the error line; the button offers the copy again.
        failed: COPY_LINK_LABELS.idle,
        onDone: () => {
          // An earlier failed copy's advice is out of date now.
          if (dom.errorBox.textContent === COPY_LINK_LABELS.failed) {
            dom.errorBox.textContent = "";
          }
        },
        onFailed: () => {
          dom.errorBox.textContent = COPY_LINK_LABELS.failed;
        },
      },
    ).finally(() => {
      copying = false;
    });
  }

  async function enterAr(): Promise<void> {
    // The visitor's location-only tap (DEC-N2): request, re-label, and let
    // the next tap start the session inside its own user activation.
    if (locationGate.pending()) {
      hadLocationStep = true;
      await locationGate.request();
      return;
    }
    // A codes-only start reads the permission again first (M1b-1 review
    // #3): a grant in the settings starts with GPS, a dismissed prompt is
    // offered once more - then this tap is not a start.
    if (!authorMode && locationGate.codesOnly()) {
      await locationGate.recheck();
      if (locationGate.pending()) return;
    }
    // The start the two steps led to: a later start is one tap again.
    hadLocationStep = false;
    ctx.cameraFrameCount = 0;
    // A refused AUTHOR pipeline (bad size, no detector) keeps AR unstarted —
    // the message is already in the author panel, where the author is
    // looking. The viewer pipeline is best-effort: without a detector the
    // session is plain AR.
    if (authorMode && !hooks.startAuthorPipeline()) return;
    // A visitor who declined location starts on codes alone (QR-first
    // M1b-1): no location permission, no GPS watch; the scan gate then
    // offers no GPS escape. Set before the pipeline and its gate start.
    ctx.codesOnly = !authorMode && locationGate.codesOnly();
    if (!authorMode) hooks.startViewerPipeline();
    const depth = entryDepth();
    const result = await arController.enable(
      buildArEnableConfig({
        container: dom.arRoot,
        requestHitTest: mode === "creator",
        ...(ctx.codesOnly ? { location: "none" as const } : {}),
        trackingStore: arStore,
        onFrame: (frame) => {
          ctx.cameraFrameCount += 1;
          // The most recent frame is what "Capture a photo" encodes (M4).
          // The source hands out a fresh copy per frame (camera-blit-capture
          // `flippedPixelCopy`), so keeping the reference is safe. The frame
          // carries its own capture pose, which the photo is placed with.
          ctx.latestFrame = frame;
          ctx.qrController?.offerFrame(frame);
          renderArStatus();
          hooks.tickStations();
        },
        onSessionEnd,
        onGpsPosition: (position) => {
          gpsHandler(position);
        },
        onOrientation: (orientation) => {
          updateDeviceOrientation(orientation);
        },
        // The mesh cursor's grid is raw WebXR: an origin reset leaves its
        // cells in a dead frame, so it starts again (F11).
        ...(authorMode && deps.meshCursor === true
          ? {
              onTrackingRestarted: () => {
                meshSurface?.reset();
              },
            }
          : {}),
        ...depth.hooks,
      }),
    );
    // Failure states surface via the subscribed button view (Retry — <reason>).
    // No session ran, so no session end disposes the pipeline started above;
    // a retry would build another on top of it (a declined permission
    // prompt, 2026-10-07).
    if (!result.ok) {
      endQrPipeline(ctx);
      return;
    }
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
    startEntryDepth(depth);
    // The world group exists only AFTER initAR built the scene graph —
    // creating the glue check earlier made it dead code in production
    // (PR #360 review). The snapshot for the alignment gate belongs to the
    // same moment: this session's fixes start counting now.
    ctx.gpsSamplesAtSessionStart = selectGpsPositions(
      arStore.getState(),
    ).length;
    ctx.frameEpochAtSessionStart =
      arStore.getState().qrDetected.frameEpoch ?? 0;
    // BOTH modes glue the marker to detections — the author's accuracy check
    // and the viewer's "it relocalized" proof are the same axis+cube.
    const worldGroup = seams.getArWorldGroup();
    if (worldGroup !== null) {
      ctx.qrDebugView = seams.createQrDebugView(worldGroup);
      // The creator's reticle (M4): under the world group, so its world
      // position is GPS-world NUE once the alignment lands. A tap in AR
      // selects the object under it (authoring plan 2026-09-28-0953 M4;
      // taps on the panel are cancelled there, `beforexrselect`).
      if (authorMode) {
        // The ring follows a mesh of the surroundings where there is one,
        // the hit-test elsewhere (polish round M5; off with ?mesh=0).
        meshSurface =
          deps.meshCursor === true ? startMeshSurfaceSafely(worldGroup) : null;
        const surface = meshSurface;
        ctx.reticle = seams.startHitTestReticle(
          worldGroup,
          (tap) => {
            hooks.selectInView(tap);
          },
          surface === null ? undefined : () => surface.pick(),
        );
      }
    }
    if (authorMode) hooks.beginAuthorVisit();
    // The scan gate first (M5): a creator's is `not-required/creator` (a
    // real state, M5 review #11), a visitor's holds placement back until
    // the code locks; the subscription below re-attempts on every dispatch
    // once it passes.
    hooks.startScanGate();
    if (authorMode) {
      hooks.renderAuthorReadout();
      return;
    }
    // The ready-triggered placement (flows plan M4, DEC-F3): attempt on
    // every dispatch while the session lives - `tryPlaceTour` is a few
    // predicate reads until the tracking-quality phase is `ready`, then
    // runs once.
    ctx.placementAttempted = false;
    ctx.placementUnsubscribe = arStore.subscribe(() => {
      hooks.tryPlaceTour();
      // The stations (tour kit plan K4) are judged on every GPS fix too.
      hooks.tickStations();
    });
    hooks.tryPlaceTour();
    hooks.tickStations();
    renderArStatus();
  }

  arController.subscribe(renderArState);
  renderArState(arController.getState());
  void arController.refreshSupport();
  dom.enterArButton.addEventListener("click", () => {
    // During a session the button is the way out (UI round 1, U2): the
    // session end runs the same teardown as the back gesture.
    if (arController.getState().status === "running") {
      // A creator's Done finishes when it can (polish round M3, Q-Done);
      // the finish ends the session itself once the zip is written.
      if (
        authorMode &&
        !ctx.finishing &&
        ctx.finishError === null &&
        hooks.finishFromAr()
      ) {
        renderArState(arController.getState());
        return;
      }
      arController.disable().catch((err: unknown) => {
        dom.errorBox.textContent = describeOpenError(err);
      });
      return;
    }
    // Hidden then; a tap that still arrives asks for nothing.
    if (startWithheld()) return;
    if (!authorMode && arController.getState().status === "unsupported") {
      copyLink();
      return;
    }
    // Inside the tap, before any await: the stories' one audio element
    // may play later only if it played in a gesture (tour kit plan K4).
    if (!authorMode) hooks.unlockStationAudio();
    // Defensive: enable() reports failures via its state machine, but a
    // rejection anywhere else (e.g. the rollback disable()) must reach the
    // error box, not die as an unhandled rejection.
    enterAr().catch((err: unknown) => {
      dom.errorBox.textContent = describeOpenError(err);
    });
  });

  return {
    renderArStatus,
    renderArEntry: () => {
      renderArState(arController.getState());
    },
  };
}
